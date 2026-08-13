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
import {isRegistered} from '$lib/onchain/delegation';
import {
	chooseRegistrationRoute,
	registrationRequest,
	sameAddress,
	type RegistrationRoute,
} from '$lib/ui/delegation/registration';
import {
	delegationAccountOf,
	signDelegation,
	signsWithoutPrompt,
	submitRegistration,
	type DelegationAccount,
	type RegistrationWriter,
} from '$lib/ui/delegation/register-delegate';
import {
	walletCanActAs,
	walletSelectedInstead,
} from '$lib/core/connection/wallet-account';
import {
	fundAddress,
	fundSignerFromAccount,
	getCredits,
	TRANSFER_GAS,
	type GetCreditsResult,
} from './get-credits';
import {signerAccountOf} from './credits-view';
import {
	availablePaymentMethods,
	paymentMethods,
	NO_PAYMENT_METHOD_EXPLANATION,
	type PaymentMethod,
	type PaymentMethodId,
} from './payment-methods';

/**
 * Topping up the in-app balance, as one flow rather than three buttons.
 *
 * What the user wants is "let me play"; what that takes is a way to pay, some
 * money behind it, and a transfer. The old UI exposed the pieces as controls
 * sitting next to each other, so the user had to know which one their situation
 * called for. They are steps, so this walks them: choose how to pay, connect
 * whatever that needs, and if the payer has nothing to send, offer the faucet
 * first and come back to the transfer once the money lands.
 *
 * THE FIRST TOP-UP IS ALSO THE REGISTRATION. The registry only accepts a
 * greeting on the account's behalf from an address the account has authorised,
 * and both register entry points take a `payee` that forwards `msg.value`. So a
 * signer that is not yet a delegate is registered AND funded in one
 * transaction, which is the whole reason that parameter exists: a freshly
 * derived signer holds nothing, and an address that cannot pay for gas cannot
 * do the thing it was just authorised to do. Folding it in here rather than
 * bolting a second flow alongside keeps that one transaction one flow.
 *
 * ONE flow object for the whole app, held in the context, because it is driven
 * from three places: the account panel, the insufficient-funds modal when the
 * signer is the account that cannot pay, and the demo's Send when the signer is
 * not yet a delegate. Two independent copies would let the user open a second
 * top-up on top of one already running.
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
 * Gas to keep back for a registration, which is a contract call rather than a
 * plain transfer.
 *
 * One figure for both register entry points. They differ (recovering a
 * signature costs more than not having one), but this is a RESERVE, it already
 * carries the safety multiplier below, and being generous costs the user a
 * slightly smaller first top-up while being short costs them a transaction that
 * cannot be sent.
 */
export const REGISTRATION_GAS = 150_000n;

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
 * cannot be the next thing that happens. `consent` is the explanation shown
 * before the wallet asks for a signature handing this browser authority over
 * the account, so what appears in the wallet is not the first they hear of it.
 */
export type TopUpPhase =
	| 'idle'
	/** Working out who can pay, before anything is offered. */
	| 'preparing'
	/** The set of payment methods, for the user to pick from. */
	| 'choosing'
	/** Nothing here can work, with an honest explanation of why. */
	| 'unavailable'
	| 'connecting'
	| 'empty'
	| 'claiming'
	/**
	 * What this will cost and, when it also authorises this browser, what that
	 * means. ONE step: the explanation belongs immediately before the wallet
	 * opens, and that is exactly where the confirm button already is, so making
	 * it a step of its own only added a click between reading and acting.
	 */
	| 'ready'
	/**
	 * The wallet is on a different account than the one about to be asked to act.
	 *
	 * Its own step because it is the user's to resolve, in their wallet, and
	 * nothing the app can do moves it along.
	 */
	| 'switch-account'
	| 'sending'
	/** Stopped before there was anything to act on, e.g. no payer connected. */
	| 'failed';

export type TopUpState = {
	phase: TopUpPhase;
	/** The modal is showing: every phase except the closed one. */
	open: boolean;
	/** A step is in flight, so the controls are disabled. */
	busy: boolean;
	/** The ways to pay, with an availability answer for each. */
	methods: readonly PaymentMethod[];
	/** The one the user picked. */
	method: PaymentMethodId | undefined;
	/**
	 * Whether this payment also authorises the signer.
	 *
	 * Drives the wording (the user is agreeing to more than a transfer) and the
	 * gas reserve (a contract call, not a plain transfer).
	 */
	registering: boolean;
	/** How the authorisation will be proven, once the payer is known. */
	route: RegistrationRoute['kind'] | undefined;
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
	/**
	 * What a faucet claim dispensed, when one succeeded.
	 *
	 * Kept so every later read can floor the payer's balance at it. The wallet's
	 * own answer is allowed to be behind; this is not.
	 */
	dispensed: bigint | undefined;
	/**
	 * The amount on offer is ahead of what the chain read reported, because we
	 * watched the money arrive.
	 *
	 * The transaction is fine to send - nonce ordering takes care of that - but
	 * the WALLET may still be showing the old balance and refuse to sign until it
	 * catches up. Saying so beats a user staring at a wallet that claims they
	 * have nothing, with the app insisting they do.
	 */
	fundsPending: boolean;
	/** Why nothing can be done, on the `unavailable` phase. */
	explanation: string | undefined;
	/**
	 * The account the wallet has to be switched back to, on `switch-account`,
	 * and the one it is on instead.
	 */
	switchTo: `0x${string}` | undefined;
	switchFrom: `0x${string}` | undefined;
	/** What that account is needed FOR, so the ask is not a bare instruction. */
	switchReason: 'sign' | 'pay' | undefined;
	/**
	 * Whether the wallet that will sign does so without showing anything.
	 *
	 * Wording only: the development burner signs silently, and promising a prompt
	 * that never appears leaves the user waiting for it.
	 */
	silentSigner: boolean;
	error: string | undefined;
	details: string | undefined;
};

const CLOSED: TopUpState = {
	phase: 'idle',
	open: false,
	busy: false,
	methods: [],
	method: undefined,
	registering: false,
	route: undefined,
	payer: undefined,
	value: 0n,
	valueText: '0',
	creditsText: undefined,
	claimed: false,
	dispensed: undefined,
	fundsPending: false,
	explanation: undefined,
	switchTo: undefined,
	switchFrom: undefined,
	switchReason: undefined,
	silentSigner: false,
	error: undefined,
	details: undefined,
};

export type TopUpFlowDeps = FaucetClaimDeps &
	Pick<
		Context,
		| 'connection'
		| 'payment'
		| 'signerBalance'
		| 'credits'
		| 'deployments'
		| 'delegation'
		| 'confirmation'
	>;

export type TopUpFlowConfig = {
	faucetApi?: string;
	faucetLink: string;
	/** Whether a faucet is configured; without one an empty payer is a dead end. */
	hasFaucet: boolean;
};

/**
 * What a payer can send, and whether that figure is ahead of the chain read.
 */
type Sendable = {value: bigint; pending: boolean};

export type TopUpFlow = Readable<TopUpState> & {
	/** Open the flow: work out who can pay, and offer the choice. */
	start(): Promise<void>;
	/** Take one of the offered payment methods. */
	choose(method: PaymentMethodId): Promise<void>;
	/** Send the faucet at whoever is paying, then return to the transfer step. */
	claim(): Promise<void>;
	/** Re-read the payer's balance. */
	refresh(): Promise<void>;
	confirm(): Promise<void>;
	/** Try again once the user says they have switched account in their wallet. */
	retry(): Promise<void>;
	/** Back to the list of payment methods. */
	back(): void;
	/**
	 * The user asked to close the modal by clicking away from it or pressing
	 * escape, which is NOT the same as pressing Cancel. See the implementation.
	 */
	dismiss(): void;
	cancel(): Promise<void>;
};

export function createTopUpFlow(
	deps: TopUpFlowDeps,
	config: TopUpFlowConfig,
): TopUpFlow {
	const {
		connection,
		payment,
		signerBalance,
		credits,
		deployments,
		delegation,
		accountExecutor,
		publicClient,
		balanceCheck,
		confirmation,
	} = deps;
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

	/**
	 * The owner's signature, once obtained, for the rest of THIS run.
	 *
	 * Held because the run can pause after it: a wallet that exposes one account
	 * at a time has to be switched back to the payer before the transaction can
	 * be sent, and re-entering the flow must not ask the owner to sign the same
	 * authorisation again. Dropped with the run, since it authorises one specific
	 * signer for one specific origin.
	 */
	let signature: `0x${string}` | undefined;

	const set = (patch: Partial<TopUpState>) => {
		const was = state.phase;
		state = {...state, ...patch};
		state.open = state.phase !== 'idle';
		state.busy =
			state.phase === 'preparing' ||
			state.phase === 'connecting' ||
			state.phase === 'claiming' ||
			state.phase === 'sending';

		// A question about a wallet request stops mattering the moment the wallet
		// answers. Taking it back here rather than in each caller means every way
		// out of that state does it: the signature arriving, the transaction
		// landing, an error, or the user cancelling anyway.
		if (was === 'sending' && state.phase !== 'sending') {
			confirmation.withdraw();
		}

		// The path a run took, in development only.
		//
		// This flow spans two wallets, a faucet, a signature and a transaction, and
		// when it stops somewhere unexpected the modal shows only where it ended up.
		// A line per step is what makes "it just did nothing" reportable, by anyone,
		// without attaching a debugger.
		if (import.meta.env.DEV && state.phase !== was) {
			console.log(
				`[top-up] ${was} -> ${state.phase}`,
				JSON.stringify({
					method: state.method,
					route: state.route,
					registering: state.registering,
					payer: state.payer,
					value: state.value.toString(),
					error: state.error,
				}),
			);
		}

		store.set(state);
	};

	const currency = () => deployments.get().chain.nativeCurrency;

	/** The account, its signer and what the connection can prove about them. */
	const delegationAccount = (): DelegationAccount | undefined =>
		delegationAccountOf(get(connection));

	/** Whether the authenticated account can submit a transaction at all. */
	const ownerCanSend = (): boolean => get(accountExecutor).status === 'ready';

	/**
	 * The fee the transaction should be priced at.
	 *
	 * `estimateFeesPerGas` rather than `getGasPrice`, because it is an EIP-1559
	 * transaction and `getGasPrice` reports roughly the base fee alone. Reserving
	 * that much left out the priority tip, so the reserve was short and the
	 * top-up could exceed what the payer could actually send. Falls back to
	 * `getGasPrice` for chains that do not support the estimate at all.
	 */
	/** The public client that reads the chain for a given payer. */
	const readerFor = (method: PaymentMethodId | undefined) =>
		method === 'account' ? publicClient : payment.publicClient;

	const feePerGas = async (reader: {
		estimateFeesPerGas: () => Promise<{maxFeePerGas?: bigint} | undefined>;
		getGasPrice: () => Promise<bigint>;
	}): Promise<bigint> => {
		try {
			const fees = await reader.estimateFeesPerGas();
			if (fees?.maxFeePerGas) return fees.maxFeePerGas;
		} catch {
			// Legacy chain, or a node without a fee history. Priced below instead.
		}
		return reader.getGasPrice();
	};

	/**
	 * What this payer could send right now, after the gas of sending it.
	 *
	 * The gas depends on WHAT is being sent: a registration is a contract call,
	 * an ordinary top-up is a plain transfer. Reserving the transfer's gas for a
	 * registration would size a top-up the payer cannot afford to send, which is
	 * the exact failure the reserve exists to prevent.
	 */
	const readSendable = async (
		address: `0x${string}`,
		method: PaymentMethodId | undefined,
		registering: boolean,
		/**
		 * A balance we know the payer holds regardless of what the chain says,
		 * because we just watched it arrive.
		 *
		 * An injected wallet answers `eth_getBalance` from a cache until it sees a
		 * new block, so a read straight after a faucet claim reports the balance
		 * from BEFORE the claim. Taking the larger of the two means a wallet that
		 * has not caught up cannot tell the user their freshly funded account is
		 * empty, and a wallet that HAS caught up still wins when it knows more (the
		 * payer may have held something already).
		 */
		knownToHold?: bigint,
	): Promise<Sendable> => {
		const reader = readerFor(method) as unknown as {
			getBalance: (a: {address: `0x${string}`}) => Promise<bigint>;
			estimateFeesPerGas: () => Promise<{maxFeePerGas?: bigint} | undefined>;
			getGasPrice: () => Promise<bigint>;
		};
		const [reported, maxFeePerGas] = await Promise.all([
			reader.getBalance({address}),
			feePerGas(reader),
		]);
		// AHEAD OF THE READ, deliberately: the money is on chain, and Ethereum's
		// nonce ordering means a transaction sent now is fine even if the node
		// answering us has not caught up. But the WALLET has to agree before it
		// will let the user sign, and a wallet that is behind shows the old
		// balance and refuses. So the figure is optimistic and says that it is,
		// rather than either refusing or pretending everything is settled.
		const behind = !!knownToHold && knownToHold > reported;
		const balance = behind ? knownToHold : reported;
		return {
			value: maxTopUp({
				balance,
				maxFeePerGas,
				credits,
				gas: registering ? REGISTRATION_GAS : TRANSFER_GAS,
			}),
			pending: behind,
		};
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

	/** How many wallets the PAYMENT connection can see, which is the one used. */
	const walletsAvailable = (): number => {
		const $payment = get(payment.connection) as unknown as {
			wallets?: unknown[];
		};
		return $payment?.wallets?.length ?? 0;
	};

	/**
	 * Which proof of authorisation this payer can produce.
	 *
	 * Undefined when the signer is already a delegate, because then there is
	 * nothing to prove and this is an ordinary transfer.
	 */
	const routeFor = (payer: `0x${string}` | undefined): RegistrationRoute => {
		const account = delegationAccount();
		const $delegation = get(delegation);
		return chooseRegistrationRoute({
			owner: account?.owner,
			payer,
			ownerCanSend: ownerCanSend(),
			savedSignature: account?.savedSignature,
			ownerCanSignLive: !!account?.canSignLive,
			withdrawn: $delegation.step === 'Loaded' ? $delegation.withdrawn : false,
		});
	};

	/** Land on the transfer step, or on the faucet step when nothing can be sent. */
	const settle = (payer: `0x${string}`, sendable: Sendable) => {
		const {value} = sendable;
		const route = state.registering ? routeFor(payer) : undefined;

		// A payer that cannot prove the authorisation is a dead end for THIS
		// payer, and saying so beats sending a transaction that reverts.
		if (route?.kind === 'unavailable') {
			set({
				phase: 'unavailable',
				payer,
				route: 'unavailable',
				explanation: route.reason,
			});
			return;
		}

		const {decimals} = currency();
		set({
			phase: value === 0n ? 'empty' : 'ready',
			payer,
			fundsPending: sendable.pending,
			route: route?.kind,
			// The confirm step carries the explanation of what is about to be signed,
			// so it needs to know whether a wallet will actually prompt.
			silentSigner: signsWithoutPrompt(get(connection)),
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
	// Everything that depends on the payer is re-derived here: who is shown, how
	// much can be sent, and which registration route is open to them.
	let reading = 0;
	payment.connection.subscribe(($payment) => {
		if (state.method !== 'wallet') return;
		if (state.phase !== 'ready' && state.phase !== 'empty') return;

		// `accountChanged` FIRST: it holds the new account, while `account` is
		// still the old one until the change is adopted.
		const changed = accountChangedOf($payment);
		const target = changed ?? payerAddressOf($payment);
		if (!target) return;
		if (sameAddress(target, state.payer)) return;

		const token = ++reading;
		const mine = session;
		void (async () => {
			try {
				// Adopt it, so the connection the transfer is sent through points at
				// the account being shown. Without this the modal would name one
				// account and pay from another.
				if (changed) await payment.connection.connectToAddress(changed);
				const sendable = await readSendable(
					target,
					'wallet',
					state.registering,
				);
				// A later change won the race; its result is the current one.
				if (token !== reading || stale(mine)) return;
				settle(target, sendable);
				// A different account has not been fauceted, whatever the last one did,
				// so what the faucet dispensed says nothing about THIS one's balance.
				set({
					claimed: false,
					dispensed: undefined,
					error: undefined,
					details: undefined,
				});
			} catch (error) {
				if (token !== reading) return;
				console.error('Could not switch to the new account', error);
				set({error: 'Could not switch to the account the wallet selected'});
			}
		})();
	});

	/**
	 * Stop unless the wallet can act as `address` right now.
	 *
	 * The wallet decides who it will act as, and the app's connection is only its
	 * record of who it last agreed to. A wallet exposing one account at a time
	 * (Rabby) leaves those two disagreeing the moment the user switches, and then
	 * a signature comes back from the wrong key or a transaction is refused, both
	 * as an opaque wallet error. Asking first turns that into an instruction.
	 *
	 * Returns whether to carry on; when it stops, the flow is parked on the
	 * switch-account step with a Retry that resumes exactly here.
	 */
	const ensureWalletIsOn = async (
		target: {subscribe: Readable<unknown>['subscribe']},
		address: `0x${string}`,
		reason: 'sign' | 'pay',
	): Promise<boolean> => {
		const $target = get(target);
		if (walletCanActAs($target, address)) return true;
		set({
			phase: 'switch-account',
			switchTo: address,
			switchFrom: walletSelectedInstead($target, address),
			switchReason: reason,
		});
		return false;
	};

	/** Ask the owner's wallet for the authorisation, normalising the outcome. */
	const sign = async (
		account: DelegationAccount,
		mine: number,
	): Promise<
		| {status: 'signed'; signature: `0x${string}`}
		| {status: 'cancelled'}
		| {status: 'error'; message: string; details: string}
	> => {
		try {
			const signed = await signDelegation({
				$connection: get(connection),
				account,
			});
			if (stale(mine)) return {status: 'cancelled'};
			return {status: 'signed', signature: signed};
		} catch (error) {
			if (isUserRejectionError(error)) return {status: 'cancelled'};
			console.error('Could not sign the delegation message', error);
			return {
				status: 'error',
				message: 'The authorisation was not signed, so nothing was sent.',
				details: error instanceof Error ? error.stack || '' : String(error),
			};
		}
	};

	/**
	 * End the current run.
	 *
	 * Unconditional, including mid-step: see `session`. Deliberate, because the
	 * only things that reach it are the Cancel button and a dismissal that has
	 * already been checked (see `dismiss`). A named function rather than a method,
	 * so it does not depend on how it was called.
	 */
	const cancelRun = () => {
		session++;
		signature = undefined;
		set({...CLOSED});
	};

	/**
	 * Faucet the account the modal is NAMING.
	 *
	 * `state.payer` and nothing else. It is the address shown, the address the
	 * amount was priced from, and the address the transaction will be sent by, so
	 * asking anything else who is paying can only introduce a disagreement -
	 * which is exactly what happened: the faucet funded an account the user was
	 * not looking at, while the screen went on showing an empty one.
	 */
	const claimForPayer = (payer: `0x${string}`) =>
		fundAddress(
			deps,
			{faucetApi: config.faucetApi, faucetLink: config.faucetLink},
			payer,
		);

	/** Whether the signer still has to be authorised, read fresh from the chain. */
	const resolveRegistering = async (): Promise<boolean> => {
		const account = delegationAccount();
		if (!account) return false;
		// Read now rather than trusting the poll: this decides which methods can
		// work and how much gas to keep back, and a stale "already registered"
		// would size the top-up for a transfer and then send a contract call.
		const $delegation = await delegation.update();
		return !isRegistered($delegation, account.delegate);
	};

	/** Perform the payment (and the registration, when there is one). */
	const perform = async (): Promise<void> => {
		const mine = session;
		const signer = signerAccountOf(get(connection));
		const account = delegationAccount();
		if (!signer || !account) {
			// A phase as well as the message: this can be reached from 'sending', and
			// leaving it there would spin forever on a run that has already stopped.
			// Every early return below owes the user the same.
			set({
				phase: state.value > 0n ? 'ready' : 'failed',
				error: 'Signed out, so there is nothing to top up',
			});
			return;
		}

		// The amount was computed from a specific account's balance, so it is only
		// valid for that account. If the wallet switched between the last read and
		// this click (the watcher above is asynchronous, this is not), re-read
		// instead of sending a figure sized for somebody else.
		if (state.method === 'wallet') {
			const current = payerAddressOf(get(payment.connection));
			if (current && state.payer && !sameAddress(current, state.payer)) {
				const sendable = await readSendable(
					current,
					'wallet',
					state.registering,
				);
				if (stale(mine)) return;
				settle(current, sendable);
				set({
					claimed: false,
					dispensed: undefined,
					error: 'The wallet switched account. Check the amount and continue.',
				});
				return;
			}
		}

		// Resolved HERE, once, rather than trusting what the last read settled on:
		// the payer decides the route, and the payer can change under an open modal.
		// Two places deciding this is how a signature gets requested without the
		// explanation the user was promised.
		const route = state.registering ? routeFor(state.payer) : undefined;

		if (route?.kind === 'unavailable') {
			set({
				phase: 'unavailable',
				route: 'unavailable',
				explanation: route.reason,
			});
			return;
		}

		// THE OWNER'S SIGNATURE, taken while the wallet is actually on the owner's
		// account. Held for the run, so a wallet that has to be switched back and
		// forth is never asked to sign the same thing twice.
		if (route?.kind === 'pre-signed') signature = route.signature;

		if (route?.kind === 'live-signature' && !signature) {
			if (!(await ensureWalletIsOn(connection, account.owner, 'sign'))) return;

			set({phase: 'sending', error: undefined, details: undefined});
			const signed = await sign(account, mine);
			if (stale(mine)) return;
			if (signed.status !== 'signed') {
				set(
					signed.status === 'cancelled'
						? {phase: 'ready'}
						: {
								phase: 'ready',
								error: signed.message,
								details: signed.details,
							},
				);
				return;
			}
			signature = signed.signature;
		}

		// AND ONLY THEN the payer, which for a one-account-at-a-time wallet is the
		// account the user has just been asked to switch AWAY from. Checking it
		// after the signature rather than before is what makes that one switch each
		// way instead of a dance the user has to work out for themselves.
		if (state.method === 'wallet' && state.payer) {
			if (!(await ensureWalletIsOn(payment.connection, state.payer, 'pay'))) {
				return;
			}
		}

		// Captured BEFORE sending, for the transaction that may be waiting on
		// this. A transaction blocked on the signer's balance is resumed by
		// watching that balance CHANGE, so the watcher needs the value it is
		// changing from.
		const before = get(signerBalance);
		const beforeValue = before.step === 'Loaded' ? before.value : 0n;

		set({phase: 'sending', error: undefined, details: undefined});

		const result = route
			? await registerAndFund(account, signature, mine)
			: await fundOnly(signer.address);

		if (stale(mine)) return;

		if (result.status === 'bought') {
			// Tells whatever is blocked on the signer's balance to start watching
			// for it to move. A no-op unless something actually is (see
			// balance-check-store), so this is safe from the panel too.
			balanceCheck.markFundingRequested(beforeValue);
			void signerBalance.update();
			set({...CLOSED});
		} else if (result.status === 'insufficient') {
			// Pre-computed from the payer's balance, so reaching here means it moved
			// under us. Re-read rather than re-offering a stale figure.
			const payer = state.payer;
			if (payer) {
				const sendable = await readSendable(
					payer,
					state.method,
					state.registering,
					state.dispensed,
				);
				if (stale(mine)) return;
				settle(payer, sendable);
			}
			set({error: 'The paying account can no longer cover that amount'});
		} else if (result.status === 'cancelled') {
			set({phase: 'ready'});
		} else {
			set({phase: 'ready', error: result.message, details: result.details});
		}
	};

	/** An ordinary top-up: the signer is already a delegate, so this is a transfer. */
	const fundOnly = async (to: `0x${string}`): Promise<GetCreditsResult> => {
		if (state.method === 'account') {
			return fundSignerFromAccount(deps, {to, value: state.value});
		}
		return getCredits({payment, signerBalance}, {to, value: state.value});
	};

	/**
	 * Register the signer and fund it in ONE transaction.
	 *
	 * Which entry point, and who sends it, both fall out of the route:
	 * - `direct`: the owner sends `registerDelegate` itself, so no signature
	 *   exists and none is needed. Reached both by paying from the account and by
	 *   pointing the payment rail at the account the user signed in as.
	 * - `pre-signed`: the connection already carries the owner's signature, so
	 *   there is nothing to prompt.
	 * - `live-signature`: the owner's wallet is asked for it now, after the
	 *   consent step has explained what is being signed.
	 */
	const registerAndFund = async (
		account: DelegationAccount,
		signature: `0x${string}` | undefined,
		mine: number,
	): Promise<GetCreditsResult> => {
		if (stale(mine)) return {status: 'cancelled'};

		const request = registrationRequest({
			owner: account.owner,
			// The signer's OWN origin, in both places. It is part of the signed
			// text, so a value derived again here could differ by a byte and the
			// contract would recover a different address.
			origin: account.origin,
			delegate: account.delegate,
			value: state.value,
			signature,
		});

		// The contract the delegation state was READ from, rather than a second
		// lookup: registering anywhere else would spend the user's money and leave
		// the send this was unblocking still blocked. See onchain/delegation.
		const {registry} = delegation;

		// The direct route is the owner sending, which for the account method is
		// the app's own account executor and for the payment method is the payment
		// rail pointed at that same account. Everything else is submitted by the
		// payer, whoever they are.
		const viaAccount = state.method === 'account';
		const $executor = get(accountExecutor);
		if (viaAccount && $executor.status !== 'ready') {
			return {
				status: 'error',
				message: 'This account cannot send a transaction.',
				details: `account executor status: ${$executor.status}`,
			};
		}

		// One cast, at the one place the mismatch is: the entry point is decided at
		// runtime, and viem's writeContract types are built for a call site that
		// names one function literally. See RegistrationWriter.
		const client = (viaAccount && $executor.status === 'ready'
			? $executor.client
			: payment.walletClient) as unknown as RegistrationWriter;

		const result = await submitRegistration({
			registry: {address: registry.address, abi: registry.abi},
			client,
			publicClient: readerFor(state.method),
			account:
				viaAccount && $executor.status === 'ready'
					? $executor.account
					: (state.payer as `0x${string}`),
			request,
		});

		if (result.status === 'registered') {
			// The rest of the app gates on this read, so refresh it before the modal
			// closes: a Send offered against a stale "not registered" would send the
			// user straight back here.
			await delegation.update();
			return {status: 'bought'};
		}
		return result;
	};

	return {
		subscribe: store.subscribe,

		async start() {
			if (state.busy) return;
			const mine = ++session;
			signature = undefined;
			set({...CLOSED, phase: 'preparing'});
			try {
				const registering = await resolveRegistering();
				if (stale(mine)) return;
				set({registering});

				const canSend = ownerCanSend();
				const owner = delegationAccount()?.owner;
				// Only ask the chain what the account holds when it could actually
				// send: without a wallet the figure decides nothing.
				const accountSpendable =
					canSend && owner
						? (await readSendable(owner, 'account', registering)).value
						: 0n;
				if (stale(mine)) return;

				const $delegation = get(delegation);
				const methods = paymentMethods({
					accountSpendable,
					ownerCanSend: canSend,
					walletsAvailable: walletsAvailable(),
					blockedFromSignatureRoute:
						registering &&
						$delegation.step === 'Loaded' &&
						$delegation.withdrawn,
				});

				const available = availablePaymentMethods(methods);
				if (available.length === 0) {
					// A real, reachable state rather than a bug: a hosted account in a
					// browser with no wallet can neither send nor find a wallet to pay
					// with. Explained, not hidden behind a disabled button.
					set({
						phase: 'unavailable',
						methods,
						explanation: NO_PAYMENT_METHOD_EXPLANATION,
					});
					return;
				}

				// ALWAYS SHOWN, even when only one method can be used.
				//
				// It reads like a step that decides nothing, and skipping it was a
				// mistake: this screen is the only place that says WHY money is being
				// asked for at all - that this browser holds a key which has to be
				// authorised and funded, or that the in-app balance is what pays for
				// moves. Going straight to "Cost: 0.01 ETH, [Continue]" is an amount
				// with no reason attached. The unavailable methods carry their reasons
				// with them, which is the other half of the same explanation.
				set({phase: 'choosing', methods});
			} catch (error) {
				if (stale(mine)) return;
				console.error('Could not work out how to pay', error);
				set({
					phase: 'failed',
					error: 'Could not work out how to pay',
					details: error instanceof Error ? error.stack : String(error),
				});
			}
		},

		async choose(method: PaymentMethodId) {
			if (state.busy) return;
			const mine = session;
			const offered = state.methods.find((m) => m.id === method);
			if (offered && !offered.available) return;
			set({method, error: undefined, details: undefined, claimed: false});

			if (method === 'account') {
				// Nothing to connect: the account is already signed in, which is the
				// point of offering this first. One transaction, one wallet prompt.
				set({phase: 'preparing'});
				try {
					const owner = delegationAccount()?.owner;
					if (!owner) {
						set({
							phase: 'failed',
							error: 'Signed out, so there is nothing to pay with',
						});
						return;
					}
					const value = await readSendable(owner, 'account', state.registering);
					if (stale(mine)) return;
					settle(owner, value);
				} catch (error) {
					if (stale(mine)) return;
					console.error('Could not read your account', error);
					set({
						phase: 'failed',
						error: 'Could not read your account',
						details: error instanceof Error ? error.stack : String(error),
					});
				}
				return;
			}

			set({phase: 'connecting'});
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
				const value = await readSendable(payer, 'wallet', state.registering);
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
				const payer = state.payer;
				const claim = await claimForPayer(payer);
				if (stale(mine)) return;

				// WHAT THE FAUCET SAID, rather than what we hoped. A faucet refuses for
				// ordinary reasons (one claim per address and per IP per day, a
				// recipient already holding enough), and the popup can simply be
				// closed. Ignoring that told the user the claim had completed and then
				// blamed the balance for being empty - which sent them round a loop of
				// re-reading a figure that was never going to change, with the one
				// message that would have explained it thrown away.
				if (claim.status === 'cancelled') {
					// Closing the faucet is an answer, not a fault. Back to the step,
					// with the claim still on offer.
					set({phase: 'empty'});
					return;
				}
				if (claim.status === 'error') {
					// `claimed` stays false, so the offer is still "get funds" rather
					// than a Continue that re-reads an untouched balance.
					set({
						phase: 'empty',
						error: `The faucet did not fund this account: ${claim.message}`,
						details: claim.details,
					});
					return;
				}

				// Priced against what the faucet SENT, not against what the wallet says
				// the payer holds. The wallet is routinely a block behind here, and
				// believing it told a user who had just been funded that their account
				// was still empty, with a Continue that could only re-read the same
				// stale figure.
				const sendable = await readSendable(
					payer,
					state.method,
					state.registering,
					claim.dispensed,
				);
				if (stale(mine)) return;
				settle(payer, sendable);
				set({claimed: true, dispensed: claim.dispensed});
				if (sendable.value === 0n) {
					set({
						error:
							'The faucet reported success but this account still has nothing to send. Continue to look again.',
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
				// Still carrying what a claim dispensed, so a wallet that is behind
				// cannot walk this back to "empty" on a second look either.
				const sendable = await readSendable(
					payer,
					state.method,
					state.registering,
					state.dispensed,
				);
				if (stale(mine)) return;
				settle(payer, sendable);
				if (sendable.value === 0n) {
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
			await perform();
		},

		/**
		 * The user says they have switched account in their wallet.
		 *
		 * Re-runs the same checks rather than trusting the claim: the wallet is the
		 * authority on which account it holds, and if it still disagrees the user
		 * lands back here instead of on a failure they cannot read.
		 */
		async retry() {
			if (state.phase !== 'switch-account' || state.busy) return;
			set({
				switchTo: undefined,
				switchFrom: undefined,
				switchReason: undefined,
				error: undefined,
				details: undefined,
			});
			await perform();
		},

		back() {
			if (state.busy) return;
			if (state.methods.length === 0) return;
			// A different payer may not need a signature at all (it may be the owner),
			// so nothing about the last one carries over.
			signature = undefined;
			set({
				phase: 'choosing',
				method: undefined,
				payer: undefined,
				route: undefined,
				value: 0n,
				valueText: '0',
				creditsText: undefined,
				claimed: false,
				dispensed: undefined,
				fundsPending: false,
				explanation: undefined,
				error: undefined,
				details: undefined,
			});
		},

		/**
		 * Dismissing by clicking away, or with escape.
		 *
		 * REFUSED WHILE A WALLET IS THINKING, and this is the one place where
		 * clicking away must not do what Cancel does. A wallet opens in its own
		 * window and takes the focus; the first click back on the page lands
		 * outside this dialog, which the dialog reads as "close me". That tore down
		 * a run that had already asked the user to sign: the signature arrived to a
		 * flow that had been abandoned, so it was dropped, no transaction was ever
		 * sent, and nothing on screen said why. An accidental click is not consent
		 * to throw away an authorisation the user just granted.
		 *
		 * They are never trapped: Cancel is offered in every phase, including the
		 * busy ones, and that button still does exactly what it says.
		 */
		dismiss() {
			if (state.busy) return;
			cancelRun();
		},

		/**
		 * Give up on this run.
		 *
		 * ASKS FIRST while the wallet is holding a request, because cancelling HERE
		 * does not cancel it THERE. The request stays in the wallet, and approving
		 * it afterwards still signs the authorisation or sends the transaction -
		 * only now the app has stopped watching, so the money moves and nothing in
		 * the UI accounts for it.
		 *
		 * It matters more than it looks. Here the worst case is a registration that
		 * lands unnoticed, which the next chain read picks up. In a game whose move
		 * is a COMMIT, an abandoned request that the user later approves is a commit
		 * on chain that the app does not know it has to reveal, and that is not
		 * recoverable. A template should get this right where it is cheap, so the
		 * game that inherits it does not have to discover the rule.
		 *
		 * Nothing else waits: with no wallet request open there is nothing to be
		 * unsure about, so Cancel closes immediately.
		 */
		async cancel() {
			if (state.phase !== 'sending') {
				cancelRun();
				return;
			}

			const stop = await confirmation.ask({
				title: 'Your wallet may still act on this',
				explanation:
					'Stopping here does not withdraw the request from your wallet. If you approve it there, it will still go through, and this app will no longer be following it.',
				confirmLabel: 'Stop waiting',
				cancelLabel: 'Keep waiting',
				destructive: true,
			});

			// `false` also arrives when the wallet answered while the question was on
			// screen (see the withdrawal in `set`), which is the same conclusion: the
			// run is no longer waiting on anything, so there is nothing to abandon.
			if (stop) cancelRun();
		},
	};
}
