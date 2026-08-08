import {get, writable, type Readable} from 'svelte/store';
import {formatUnits} from 'viem';
import {
	formatCredits,
	toCredits,
	topUpAmount,
	type CreditsConfig,
} from '$lib/core/connection/credits';
import {isUserRejectionError} from '$lib/core/transaction';
import type {FaucetClaimDeps} from '$lib/core/ui/faucet/faucet-actions';
import type {Context} from '$lib/context/types';
import {fundPayer, getCredits, TRANSFER_GAS} from './get-credits';
import {signerAccountOf} from './credits-view';

/**
 * Topping up the in-app balance, as one flow rather than three buttons.
 *
 * What the user wants is "let me play"; what that takes is a payer wallet, some
 * money in it, and a transfer. The old UI exposed all three as controls sitting
 * next to each other ("Add ETH", "Fund the paying account", and a faucet button
 * for the user's own account that did neither), so the user had to know which
 * one their situation called for. They are steps, so this walks them: connect
 * the payer, and if it has nothing to send, offer the faucet first and come
 * back to the transfer once the money lands.
 *
 * ONE flow object for the whole app, held in the context, because it is driven
 * from two places: the account panel, and the insufficient-funds modal when the
 * signer is the account that cannot pay. Two independent copies would let the
 * user open a second top-up on top of one already running.
 *
 * The amount is not asked for. A game's top-up is a fixed purchase (see the
 * seam in ./get-credits), so this mirrors that: the flow works out the most it
 * can send and sends that, which also means there is no form to get wrong.
 */

/**
 * Ceiling for one top-up when the chain does not price an action in credits.
 *
 * A ceiling, not a target: less is sent when the payer holds less. It exists
 * because "send everything the payer has" is the wrong default for a wallet
 * that is not dedicated to this app, and because a signer only ever spends gas,
 * so a large balance parked in it is money the user cannot easily get back.
 */
export const DEFAULT_TOP_UP_CEILING = 10_000_000_000_000_000n; // 0.01 native

/**
 * How much the fee estimate is multiplied by before it is held back.
 *
 * The app does not choose what the transfer costs: it is sent through the
 * user's wallet, and the wallet picks the fee. A wallet routinely picks more
 * than `estimateFeesPerGas` returns (it adds its own priority tip, and the base
 * fee can rise between the estimate and the send), so reserving the estimate
 * exactly produces the bug this exists to stop: a top-up sized at "everything
 * the faucet gave, minus gas" that the payer then cannot afford to send.
 *
 * Two, because the reserve is only ever a few cents of gas, while getting it
 * wrong costs the user a failed transaction and a confusing wallet error.
 */
const FEE_SAFETY_MULTIPLIER = 2n;

/** Gas the transfer itself costs, which the payer must keep back. */
function gasReserve(maxFeePerGas: bigint, gas: bigint = TRANSFER_GAS): bigint {
	return gas * maxFeePerGas * FEE_SAFETY_MULTIPLIER;
}

/**
 * What the payer can actually send: its balance minus the gas of sending.
 *
 * Zero rather than negative when the balance does not even cover gas, because
 * the caller's question is "how much can be sent", and the answer there is
 * none. Sending the whole balance always fails, which is the failure this
 * subtraction exists to prevent.
 */
export function spendableBalance(params: {
	balance: bigint;
	maxFeePerGas: bigint;
	gas?: bigint;
}): bigint {
	const reserve = gasReserve(params.maxFeePerGas, params.gas);
	return params.balance > reserve ? params.balance - reserve : 0n;
}

/**
 * The most one top-up is worth, before the payer's balance is considered.
 *
 * With credits configured this is the price of one top-up, so the fixed-price
 * meaning of "a top-up" survives. Without it there is no unit to price anything
 * in, so it falls back to the constant above.
 */
export function topUpCeiling(credits: CreditsConfig | undefined): bigint {
	return credits ? topUpAmount(credits) : DEFAULT_TOP_UP_CEILING;
}

/**
 * What this payer will actually send, right now.
 *
 * The lower of what a top-up is worth and what the payer can send. Taking the
 * minimum is what makes the faucet enough: a freshly fauceted payer holds
 * exactly the faucet's amount, and this lands under it by the cost of the
 * transfer instead of attempting a fixed price the payer cannot cover.
 */
export function maxTopUp(params: {
	balance: bigint;
	maxFeePerGas: bigint;
	credits: CreditsConfig | undefined;
	gas?: bigint;
}): bigint {
	const ceiling = topUpCeiling(params.credits);
	const spendable = spendableBalance(params);
	return spendable < ceiling ? spendable : ceiling;
}

/** Render a wei value for display, rounded down to a readable number of places. */
export function formatAmount(
	value: bigint,
	decimals: number,
	places = 6,
): string {
	if (decimals <= places) return formatUnits(value, decimals);
	const factor = 10n ** BigInt(decimals - places);
	return formatUnits((value / factor) * factor, decimals);
}

/**
 * Steps, in the order a user meets them.
 *
 * `empty` is the faucet step: the payer cannot send anything, so the transfer
 * cannot be the next thing that happens.
 */
export type TopUpPhase =
	| 'idle'
	| 'connecting'
	| 'empty'
	| 'claiming'
	| 'ready'
	| 'sending'
	/** Stopped before there was anything to act on, e.g. no payer connected. */
	| 'failed';

export type TopUpState = {
	phase: TopUpPhase;
	/** The modal is showing: every phase except the closed one. */
	open: boolean;
	/** A step is in flight, so the controls are disabled. */
	busy: boolean;
	payer: `0x${string}` | undefined;
	/** What confirming will send. */
	value: bigint;
	/** `value` in native currency, for display. */
	valueText: string;
	/** What `value` buys, when the chain prices actions. */
	creditsText: string | undefined;
	/**
	 * A faucet claim has completed for this payer.
	 *
	 * Kept so the empty step can offer "Continue" after a claim instead of only
	 * "get funds": the claim returns once its transaction is in, so the next read
	 * should see the money, and if it does not the user can retry the READ rather
	 * than claiming twice.
	 */
	claimed: boolean;
	error: string | undefined;
	details: string | undefined;
};

const CLOSED: TopUpState = {
	phase: 'idle',
	open: false,
	busy: false,
	payer: undefined,
	value: 0n,
	valueText: '0',
	creditsText: undefined,
	claimed: false,
	error: undefined,
	details: undefined,
};

export type TopUpFlowDeps = FaucetClaimDeps &
	Pick<
		Context,
		'connection' | 'payment' | 'signerBalance' | 'credits' | 'deployments'
	>;

export type TopUpFlowConfig = {
	faucetApi?: string;
	faucetLink: string;
	/** Whether a faucet is configured; without one an empty payer is a dead end. */
	hasFaucet: boolean;
};

export type TopUpFlow = Readable<TopUpState> & {
	/** Connect the payer and work out which step the user is on. */
	start(): Promise<void>;
	/** Send the faucet at the payer, then return to the transfer step. */
	claim(): Promise<void>;
	/** Re-read the payer's balance. */
	refresh(): Promise<void>;
	confirm(): Promise<void>;
	cancel(): void;
};

export function createTopUpFlow(
	deps: TopUpFlowDeps,
	config: TopUpFlowConfig,
): TopUpFlow {
	const {payment, signerBalance, credits, deployments, balanceCheck} = deps;
	const store = writable<TopUpState>({...CLOSED});
	let state: TopUpState = {...CLOSED};

	/**
	 * Which run of the flow is current.
	 *
	 * Closing has to work even mid-step: a modal whose only escape is disabled
	 * while a wallet is thinking is a trap. So `cancel` closes unconditionally and
	 * bumps this, and every step checks it after each await before writing state.
	 * Without that, a connect that resolves after the user gave up would reopen
	 * the modal on top of whatever they moved on to.
	 */
	let session = 0;
	const stale = (mine: number) => mine !== session;

	const set = (patch: Partial<TopUpState>) => {
		state = {...state, ...patch};
		state.open = state.phase !== 'idle';
		state.busy =
			state.phase === 'connecting' ||
			state.phase === 'claiming' ||
			state.phase === 'sending';
		store.set(state);
	};

	const currency = () => deployments.get().chain.nativeCurrency;

	/**
	 * The fee the transfer should be priced at.
	 *
	 * `estimateFeesPerGas` rather than `getGasPrice`, because the transfer is an
	 * EIP-1559 transaction and `getGasPrice` reports roughly the base fee alone.
	 * Reserving that much left out the priority tip, so the reserve was short and
	 * the top-up could exceed what the payer could actually send. Falls back to
	 * `getGasPrice` for chains that do not support the estimate at all.
	 */
	const feePerGas = async (): Promise<bigint> => {
		try {
			const fees = await payment.publicClient.estimateFeesPerGas();
			if (fees?.maxFeePerGas) return fees.maxFeePerGas;
		} catch {
			// Legacy chain, or a node without a fee history. Priced below instead.
		}
		return payment.publicClient.getGasPrice();
	};

	/** What this payer could send right now, after the gas of sending it. */
	const readSendable = async (address: `0x${string}`): Promise<bigint> => {
		const [balance, maxFeePerGas] = await Promise.all([
			payment.publicClient.getBalance({address}),
			feePerGas(),
		]);
		return maxTopUp({balance, maxFeePerGas, credits});
	};

	/** The address the payment connection currently holds, if any. */
	const payerAddressOf = ($payment: unknown): `0x${string}` | undefined =>
		($payment as {account?: {address?: `0x${string}`}} | undefined)?.account
			?.address;

	/**
	 * The account the WALLET switched to, which the connection has not adopted.
	 *
	 * On an account change @etherplay/connect does NOT update `account`. It
	 * records the new address as `wallet.accountChanged` and waits for the app,
	 * because for the app's own connection an account change is an identity
	 * change and must never be followed silently.
	 *
	 * It auto-adopts only when `useCurrentAccount` is set, and that same setting
	 * suppresses the account PICKER at connect time. A payer wants both: a list
	 * when the wallet offers several accounts, and following the switch when the
	 * wallet offers one at a time, as Rabby does. So the setting stays off and
	 * the change is adopted here, explicitly.
	 */
	const accountChangedOf = ($payment: unknown): `0x${string}` | undefined =>
		($payment as {wallet?: {accountChanged?: `0x${string}`}} | undefined)
			?.wallet?.accountChanged;

	/** Land on the transfer step, or on the faucet step when nothing can be sent. */
	const settle = (payer: `0x${string}`, value: bigint) => {
		const {decimals} = currency();
		set({
			phase: value === 0n ? 'empty' : 'ready',
			payer,
			value,
			valueText: formatAmount(value, decimals),
			creditsText: credits
				? formatCredits(toCredits(value, credits.creditUnit))
				: undefined,
		});
	};

	// The payer can change UNDERNEATH an open modal, and nothing here would
	// otherwise notice.
	//
	// Wallets like Rabby expose one account at a time, and switching account in
	// the wallet does not close this modal. Without following it, the modal went
	// on naming the OLD account and offering an amount computed from ITS balance,
	// and pressing continue then sent from an account the wallet no longer had
	// selected: the connection had already invalidated itself, so the attempt
	// silently reopened the wallet picker instead of paying.
	//
	// Both things that depend on the payer are re-derived here: who is shown, and
	// how much can be sent.
	let reading = 0;
	payment.connection.subscribe(($payment) => {
		if (state.phase !== 'ready' && state.phase !== 'empty') return;

		// `accountChanged` FIRST: it holds the new account, while `account` is
		// still the old one until the change is adopted.
		const changed = accountChangedOf($payment);
		const target = changed ?? payerAddressOf($payment);
		if (!target) return;
		if (state.payer && target.toLowerCase() === state.payer.toLowerCase()) {
			return;
		}

		const token = ++reading;
		const mine = session;
		void (async () => {
			try {
				// Adopt it, so the connection the transfer is sent through points at
				// the account being shown. Without this the modal would name one
				// account and pay from another.
				if (changed) await payment.connection.connectToAddress(changed);
				const sendable = await readSendable(target);
				// A later change won the race; its result is the current one.
				if (token !== reading || stale(mine)) return;
				settle(target, sendable);
				// A different account has not been fauceted, whatever the last one did.
				set({claimed: false, error: undefined, details: undefined});
			} catch (error) {
				if (token !== reading) return;
				console.error('Could not switch to the new account', error);
				set({error: 'Could not switch to the account the wallet selected'});
			}
		})();
	});

	return {
		subscribe: store.subscribe,

		async start() {
			if (state.busy) return;
			const mine = ++session;
			set({...CLOSED, phase: 'connecting'});
			try {
				// ALWAYS ask which account pays, every time.
				//
				// The payment connection persists the wallet it last used (and the
				// account), so a second top-up silently reused the first one's choice.
				// That is wrong here in a way it is not for signing in: the payer is
				// not the player's identity, it is whoever is paying THIS time, and it
				// is routinely a different account from the last one. Disconnecting
				// first clears both stored values, so the picker always appears.
				await payment.connection.disconnect();

				// Which account pays is chosen in the wallet, so the payer's address
				// and balance are unknown until this resolves.
				const $payment = await payment.connection.ensureConnected();
				const payer = $payment.account.address;
				const value = await readSendable(payer);
				if (stale(mine)) return;
				settle(payer, value);
			} catch (error) {
				if (stale(mine)) return;
				// Rejecting the wallet prompt is an answer, not a fault: close quietly.
				if (isUserRejectionError(error)) {
					set({...CLOSED});
					return;
				}
				// 'failed', not 'idle': idle closes the modal, and the modal is the only
				// place this error can be read. Closing on failure would report the
				// problem to nobody and leave the button looking inert.
				console.error('Could not connect a paying account', error);
				set({
					phase: 'failed',
					error: 'Could not connect a paying account',
					details: error instanceof Error ? error.stack : String(error),
				});
			}
		},

		async claim() {
			if (state.busy || !state.payer) return;
			const mine = session;
			if (!config.hasFaucet) {
				set({
					error:
						'No faucet is configured, so this account has to be funded elsewhere',
				});
				return;
			}
			set({phase: 'claiming', error: undefined, details: undefined});
			try {
				// The faucet returns once its transaction is IN, not merely accepted,
				// so there is nothing to wait for afterwards and no balance to poll
				// for. One read is enough, and if it somehow disagrees the user gets a
				// Continue that reads again, rather than this spinning for 30s.
				await fundPayer(deps, {
					faucetApi: config.faucetApi,
					faucetLink: config.faucetLink,
				});

				const payer = state.payer;
				const sendable = await readSendable(payer);
				if (stale(mine)) return;
				settle(payer, sendable);
				set({claimed: true});
				if (sendable === 0n) {
					set({
						error:
							'The faucet claim completed but this account still has nothing to send. It may have been ineligible.',
					});
				}
			} catch (error) {
				if (stale(mine)) return;
				// Back to the faucet step, not to the transfer step: nothing arrived,
				// so there is still nothing to send.
				console.error('Could not fund the paying account', error);
				set({
					phase: 'empty',
					error: 'Could not fund the paying account',
					details: error instanceof Error ? error.stack : String(error),
				});
			}
		},

		/** Read the payer again, for when the money arrived after the last look. */
		async refresh() {
			if (state.busy || !state.payer) return;
			const mine = session;
			const payer = state.payer;
			set({error: undefined, details: undefined});
			try {
				const sendable = await readSendable(payer);
				if (stale(mine)) return;
				settle(payer, sendable);
				if (sendable === 0n) {
					set({
						claimed: true,
						error: 'Still nothing to send from this account',
					});
				}
			} catch (error) {
				console.error('Could not read the paying account', error);
				set({error: 'Could not read the paying account'});
			}
		},

		async confirm() {
			if (state.busy || state.value === 0n) return;
			const mine = session;

			// Read the destination at send time rather than holding it: the signer
			// only exists while signed in, and sending to a stale address would put
			// the money somewhere the app can no longer spend from.
			const signer = signerAccountOf(get(deps.connection));
			if (!signer) {
				set({error: 'Signed out, so there is nothing to top up'});
				return;
			}

			// The amount was computed from a specific account's balance, so it is
			// only valid for that account. If the wallet switched between the last
			// read and this click (the watcher above is asynchronous, this is not),
			// re-read instead of sending a figure sized for somebody else.
			const current = payerAddressOf(get(payment.connection));
			if (
				current &&
				state.payer &&
				current.toLowerCase() !== state.payer.toLowerCase()
			) {
				const sendable = await readSendable(current);
				if (stale(mine)) return;
				settle(current, sendable);
				set({
					claimed: false,
					error: 'The wallet switched account. Check the amount and continue.',
				});
				return;
			}

			// Captured BEFORE sending, for the transaction that may be waiting on
			// this. A transaction blocked on the signer's balance is resumed by
			// watching that balance CHANGE, so the watcher needs the value it is
			// changing from.
			const before = get(signerBalance);
			const beforeValue = before.step === 'Loaded' ? before.value : 0n;

			set({phase: 'sending', error: undefined, details: undefined});
			const result = await getCredits(
				{payment, signerBalance},
				{to: signer.address, value: state.value},
			);

			if (stale(mine)) return;

			if (result.status === 'bought') {
				// Tells whatever is blocked on the signer's balance to start watching
				// for it to move. A no-op unless something actually is (see
				// balance-check-store), so this is safe from the panel too.
				balanceCheck.markFundingRequested(beforeValue);
				set({...CLOSED});
			} else if (result.status === 'insufficient') {
				// Pre-computed from the payer's balance, so reaching here means it
				// moved under us. Re-read rather than re-offering a stale figure.
				const payer = state.payer;
				if (payer) {
					const sendable = await readSendable(payer);
					if (stale(mine)) return;
					settle(payer, sendable);
				}
				set({error: 'The paying account can no longer cover that amount'});
			} else if (result.status === 'cancelled') {
				set({phase: 'ready'});
			} else {
				set({phase: 'ready', error: result.message, details: result.details});
			}
		},

		cancel() {
			// Unconditional, including mid-step: see `session`.
			session++;
			set({...CLOSED});
		},
	};
}
