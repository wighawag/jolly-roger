import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	createTopUpFlow,
	DEFAULT_TOP_UP_CEILING,
	formatAmount,
	maxTopUp,
	REGISTRATION_GAS,
	spendableBalance,
	topUpCeiling,
	type TopUpFlowDeps,
} from '$lib/ui/credits/top-up-flow';
import type {CreditsConfig} from '$lib/core/connection/credits';
import {
	createConfirmation,
	type ConfirmationState,
} from '$lib/core/ui/confirm/confirmation';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const PAYER = '0x00000000000000000000000000000000000000bB' as const;
const OWNER = '0x00000000000000000000000000000000000000dD' as const;
const SAVED_SIGNATURE = `0x${'ab'.repeat(65)}` as const;
const LIVE_SIGNATURE = `0x${'cd'.repeat(65)}` as const;
const ORIGIN = 'https://greetings.test';
/**
 * The contract this app delegates at, and the chain it is on.
 *
 * The PAIR, everywhere: it is what the credential is bound to (both are inside
 * the signed bytes), so the fixture uses one value for the chain read, the
 * stored record and the write.
 */
const REGISTRY = '0x00000000000000000000000000000000000000eE' as const;
const CHAIN_ID = 31337;

const GWEI = 1_000_000_000n;
const ETH = 10n ** 18n;
/** 21000 gas at 1 gwei, doubled: the reserve carries a safety multiplier
 * because the WALLET picks the fee, not us. */
const TRANSFER_COST = 21_000n * GWEI * 2n;
/** The same reserve for a registration, which is a contract call. */
const REGISTRATION_COST = REGISTRATION_GAS * GWEI * 2n;

const CREDITS: CreditsConfig = {
	creditUnit: GWEI * 100_000n, // 0.0001 ETH per credit
	creditsPerTopUp: 100, // 0.01 ETH per top-up
};

describe('spendableBalance: keeping back the gas of sending', () => {
	it('subtracts the cost of the transfer itself', () => {
		expect(spendableBalance({balance: ETH, maxFeePerGas: GWEI})).toBe(
			ETH - TRANSFER_COST,
		);
	});

	it('reports nothing spendable when the balance cannot even cover gas', () => {
		// Not a negative number: the caller's question is how much can be sent.
		expect(spendableBalance({balance: 1n, maxFeePerGas: GWEI})).toBe(0n);
		expect(spendableBalance({balance: TRANSFER_COST, maxFeePerGas: GWEI})).toBe(
			0n,
		);
	});

	it('prices a caller-supplied gas limit, for a game whose top-up is a contract call', () => {
		expect(
			spendableBalance({balance: ETH, maxFeePerGas: GWEI, gas: 100_000n}),
		).toBe(ETH - 100_000n * GWEI * 2n);
	});
});

describe('topUpCeiling: what one top-up is worth', () => {
	it('is the configured price of a top-up when the chain prices actions', () => {
		expect(topUpCeiling(CREDITS)).toBe(CREDITS.creditUnit * 100n);
	});

	it('falls back to a constant when there is no unit to price anything in', () => {
		expect(topUpCeiling(undefined)).toBe(DEFAULT_TOP_UP_CEILING);
	});
});

describe('maxTopUp: what this payer will actually send', () => {
	it('sends the full price when the payer can afford it', () => {
		expect(maxTopUp({balance: ETH, maxFeePerGas: GWEI, credits: CREDITS})).toBe(
			topUpCeiling(CREDITS),
		);
	});

	it('sends what is left after gas when the payer holds less than the price', () => {
		// The case a faucet lands in: the payer holds exactly what it was given,
		// and sending the full price would be sending more than it has.
		const balance = topUpCeiling(CREDITS);
		const value = maxTopUp({balance, maxFeePerGas: GWEI, credits: CREDITS});
		expect(value).toBe(balance - TRANSFER_COST);
		expect(value).toBeLessThan(topUpCeiling(CREDITS));
	});

	it('sends nothing when the payer cannot cover the transfer', () => {
		expect(
			maxTopUp({balance: TRANSFER_COST, maxFeePerGas: GWEI, credits: CREDITS}),
		).toBe(0n);
	});
});

describe('formatAmount', () => {
	it('rounds down, so a displayed figure never overstates what is sent', () => {
		expect(formatAmount(ETH - TRANSFER_COST, 18)).toBe('0.999958');
	});
});

type DepsParams = {
	payerBalance: bigint;
	credits?: CreditsConfig;
	/** What the AUTHENTICATED account holds, for the "pay from your account" method. */
	accountBalance?: bigint;
	/** Whether the account has a wallet and can therefore send. */
	ownerCanSend?: boolean;
	/** Whether the account's own wallet is on hand to sign a message. */
	ownerHasWallet?: boolean;
	/** The signature the connection carries for this contract, if any. */
	savedDelegationSignature?: `0x${string}`;
	/** Its deadline, in unix seconds. Zero, the default, means no expiry. */
	savedDeadline?: number;
	/** Who the stored credential is FOR. Defaults to this browser's signer. */
	savedDelegate?: `0x${string}`;
	/** The answer to every permission the app asked for at connect time. */
	permissions?: unknown[];
	/**
	 * The credential a fresh sign-in hands over, when the user takes the
	 * re-authorise remedy. Undefined means signing in again produced nothing,
	 * which lands them back on the same step.
	 */
	credentialAfterSignIn?: `0x${string}`;
	/** Whether the chain says this signer may act for the account. */
	allowed?: boolean;
	withdrawn?: boolean;
	/** How many wallets the payment connection can see. */
	walletsAvailable?: number;
	/** Which account the payment connection lands on. */
	payer?: `0x${string}`;
	/**
	 * The accounts each wallet will actually act as right now.
	 *
	 * Not the same as who the connection is connected AS: a wallet exposing one
	 * account at a time (Rabby) leaves the two disagreeing the moment the user
	 * switches. Undefined means "whatever it is connected as", i.e. agreement.
	 */
	ownerWalletAccounts?: readonly `0x${string}`[];
	payerWalletAccounts?: readonly `0x${string}`[];
	/**
	 * The account the wallet made ACTIVE, which the library records alongside a
	 * fresh `accounts` list. It means "the active one moved", never "the others
	 * are gone".
	 */
	ownerWalletActive?: `0x${string}`;
	payerWalletActive?: `0x${string}`;
	/** What the faucet's transaction turns out to have sent. */
	dispensed?: bigint;
	/** Balance the payer reads as once the claim has gone through. */
	setBalanceOnClaim?: bigint;
	/** The name the wallet announces, which decides the consent wording. */
	walletName?: string;
};

function deps(params: DepsParams) {
	const sendTransaction = vi.fn(async () => '0xhash');
	const accountSendTransaction = vi.fn(async () => '0xhash');
	// Typed arguments, so a test can read back WHICH entry point was called and
	// with what: an untyped vi.fn() records calls as an empty tuple.
	type WriteCall = {
		functionName: string;
		args: unknown[];
		value: bigint;
	};
	const paymentWriteContract = vi.fn(async (_args: WriteCall) => '0xhash');
	const accountWriteContract = vi.fn(async (_args: WriteCall) => '0xhash');
	const signMessage = vi.fn(
		async (_message: string, _address: string) => LIVE_SIGNATURE,
	);
	const markFundingRequested = vi.fn();
	const signerBalanceUpdate = vi.fn();
	const delegationUpdate = vi.fn();
	let payerBalance = params.payerBalance;
	let accountBalance = params.accountBalance ?? 0n;
	const ownerCanSend = params.ownerCanSend ?? true;
	const payerAddress = params.payer ?? PAYER;
	const wallets = new Array(params.walletsAvailable ?? 1).fill({
		info: {name: 'Test Wallet'},
	});
	const confirmation = createConfirmation();

	// The payment connection is a STORE as well as an API: the flow watches it so
	// it can follow a wallet that switches account under an open modal. Its
	// `wallets` list is also what says whether "pay with another wallet" is on
	// offer at all.
	const payerWallet = {
		accounts: params.payerWalletAccounts ?? [payerAddress],
		accountChanged: params.payerWalletActive,
	};
	const paymentConnection = Object.assign(
		writable<unknown>({step: 'Idle', wallets}),
		{
			ensureConnected: vi.fn(async () => {
				const state = {
					step: 'WalletConnected',
					account: {address: payerAddress},
					wallet: payerWallet,
					wallets,
				};
				paymentConnection.set(state);
				return state;
			}),
			disconnect: vi.fn(async () => {
				paymentConnection.set({step: 'Idle', wallets});
			}),
			// Adopting an account the wallet switched to. The library exposes this
			// but does NOT call it itself unless `useCurrentAccount` is set.
			connectToAddress: vi.fn(async (address: `0x${string}`) => {
				paymentConnection.set({
					step: 'WalletConnected',
					account: {address},
					wallets,
				});
			}),
		},
	);

	/**
	 * The signed-in account, as the connection reports it.
	 *
	 * Built from a signature rather than hardcoded, because signing in AGAIN is
	 * how a hosted account gets a fresh credential: the same shape comes back
	 * with a different record in it. See `credentialAfterSignIn`.
	 */
	const signedInState = (signature: `0x${string}` | undefined) => ({
		step: 'SignedIn',
		mechanism: {type: 'wallet', name: params.walletName ?? 'Test Wallet'},
		account: {
			address: OWNER,
			signer: {address: SIGNER, origin: ORIGIN},
			// A LIST, one entry per (chainId, contract) the app asked for and the
			// wallet granted. There is no such thing as "the" delegation.
			savedDelegations: signature
				? [
						{
							chainId: CHAIN_ID,
							contract: REGISTRY,
							delegate: params.savedDelegate ?? SIGNER,
							deadline: params.savedDeadline ?? 0,
							signature,
						},
					]
				: [],
			permissions: params.permissions,
		},
		// A wallet on the connection is what lets the owner be asked for a live
		// signature. A hosted account has none.
		wallet:
			(params.ownerHasWallet ?? true)
				? {
						provider: {signMessage},
						accounts: params.ownerWalletAccounts ?? [OWNER],
						accountChanged: params.ownerWalletActive,
					}
				: undefined,
	});

	// A store AND the two methods the re-authorise step drives. `disconnect`
	// really does drop the session in the library (it deletes the stored origin
	// account), which is why the flow tells the user so.
	const connection = Object.assign(
		writable<unknown>(signedInState(params.savedDelegationSignature)),
		{
			disconnect: vi.fn(() => {
				connection.set({step: 'Idle'});
			}),
			ensureConnected: vi.fn(async () => {
				const state = signedInState(
					params.credentialAfterSignIn ?? params.savedDelegationSignature,
				);
				connection.set(state);
				return state;
			}),
		},
	);

	const delegationValue = () => ({
		step: 'Loaded' as const,
		allowed: params.allowed ?? true,
		withdrawn: params.withdrawn ?? false,
	});

	const flowDeps = {
		connection,
		delegation: Object.assign(writable(delegationValue()), {
			update: vi.fn(async () => {
				delegationUpdate();
				return delegationValue();
			}),
			// The registration writes to the contract the delegation state was read
			// from, which the store carries. Nothing here has to know what the app
			// called it.
			registry: {chainId: CHAIN_ID, address: REGISTRY, abi: []},
		}),
		payment: {
			connection: paymentConnection,
			walletClient: {
				sendTransaction,
				writeContract: paymentWriteContract,
			},
			publicClient: {
				getBalance: vi.fn(async () => payerBalance),
				estimateFeesPerGas: vi.fn(async () => ({maxFeePerGas: GWEI})),
				getGasPrice: vi.fn(async () => GWEI),
				waitForTransactionReceipt: vi.fn(async () => ({status: 'success'})),
			},
		},
		signerBalance: Object.assign(writable({step: 'Loaded', value: 7n}), {
			update: signerBalanceUpdate,
		}),
		credits: params.credits,
		// Both a store and a `.get()`: the flow reads it synchronously, while
		// claimFaucet reads it with svelte's `get`. The real one is both. No
		// contracts on it: the flow only takes the chain's currency from here now,
		// so this fixture no longer has to impersonate a particular app.
		deployments: Object.assign(
			writable({
				chain: {id: 31337, nativeCurrency: {decimals: 18, symbol: 'ETH'}},
			}),
			{
				get: () => ({
					chain: {id: 31337, nativeCurrency: {decimals: 18, symbol: 'ETH'}},
				}),
			},
		),
		accountExecutor: writable(
			ownerCanSend
				? {
						status: 'ready',
						address: OWNER,
						account: OWNER,
						client: {
							sendTransaction: accountSendTransaction,
							writeContract: accountWriteContract,
						},
					}
				: {status: 'cannot-send'},
		),
		accountBalance: Object.assign(writable({step: 'Loaded', value: 0n}), {
			update: vi.fn(),
		}),
		// The APP's client, which is what the account route reads and waits on.
		publicClient: {
			getBalance: vi.fn(async () => accountBalance),

			estimateFeesPerGas: vi.fn(async () => ({maxFeePerGas: GWEI})),
			getGasPrice: vi.fn(async () => GWEI),
			waitForTransactionReceipt: vi.fn(async () => ({status: 'success'})),
			// What the faucet's own transaction turns out to have sent. Reading it is
			// the last thing a claim does, so it is also where a chain that has
			// already caught up starts saying so.
			getTransaction: vi.fn(async () => {
				if (params.setBalanceOnClaim !== undefined) {
					payerBalance = params.setBalanceOnClaim;
				}
				return {value: params.dispensed ?? 0n};
			}),
		},
		balanceCheck: {markFundingRequested},
		// The real one: it is pure, and a run that asks a question the test cannot
		// answer would hang rather than fail.
		confirmation,
	} as unknown as TopUpFlowDeps;

	return {
		flowDeps,
		confirmation,
		/** The question on screen, if any. */
		asking: () =>
			get(confirmation) as Extract<ConfirmationState, {step: 'asking'}>,
		sendTransaction,
		accountSendTransaction,
		paymentWriteContract,
		accountWriteContract,
		signMessage,
		markFundingRequested,
		setPayerBalance: (value: bigint) => {
			payerBalance = value;
		},
		setAccountBalance: (value: bigint) => {
			accountBalance = value;
		},
	};
}

const CONFIG = {faucetLink: 'http://faucet.test', hasFaucet: true};

/**
 * Switch which accounts a wallet will act as, the way a user switching account
 * in Rabby does: the connection keeps naming who it connected as, and only the
 * wallet's own list moves.
 */
function setWalletAccounts(
	flowDeps: TopUpFlowDeps,
	which: 'owner' | 'payer',
	accounts: readonly `0x${string}`[],
) {
	const store = (
		which === 'owner'
			? flowDeps.connection
			: (flowDeps.payment as unknown as {connection: unknown}).connection
	) as {
		subscribe: (run: (v: unknown) => void) => () => void;
		set: (v: unknown) => void;
	};
	let current: Record<string, unknown> = {};
	store.subscribe((v) => (current = v as Record<string, unknown>))();
	store.set({
		...current,
		wallet: {...(current.wallet as object), accounts},
	});
}

describe('createTopUpFlow: who can pay', () => {
	it('offers both methods when the account can cover it and a wallet is present', async () => {
		const {flowDeps} = deps({
			payerBalance: ETH,
			accountBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		const state = get(flow);
		expect(state.phase).toBe('choosing');
		expect(state.methods.map((m) => [m.id, m.available])).toEqual([
			['account', true],
			['wallet', true],
		]);
	});

	it('rules out paying from an account that cannot cover it', async () => {
		// Not eyeballed: the same fee reserve the transfer itself is sized with, so
		// an account holding exactly the gas of sending can send nothing.
		const {flowDeps} = deps({
			payerBalance: ETH,
			accountBalance: TRANSFER_COST,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		const account = get(flow).methods.find((m) => m.id === 'account');
		expect(account?.available).toBe(false);
		expect(account?.unavailableReason).toContain('does not hold enough');
	});

	it('rules out paying from an account with no wallet at all', async () => {
		const {flowDeps} = deps({
			payerBalance: ETH,
			accountBalance: ETH,
			ownerCanSend: false,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		const account = get(flow).methods.find((m) => m.id === 'account');
		expect(account?.available).toBe(false);
		expect(account?.unavailableReason).toContain('no wallet');
	});

	it('rules out another wallet when this browser has none to connect', async () => {
		const {flowDeps} = deps({
			payerBalance: ETH,
			accountBalance: ETH,
			walletsAvailable: 0,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		const wallet = get(flow).methods.find((m) => m.id === 'wallet');
		expect(wallet?.available).toBe(false);
	});

	it('asks even when only one method can be used', async () => {
		// It looks like a step that decides nothing, and skipping it was a mistake:
		// this screen is the only place that says WHY money is being asked for at
		// all. Going straight to an amount is a price with no reason attached.
		const {flowDeps} = deps({
			payerBalance: ETH,
			accountBalance: 0n, // the account cannot pay, so there is one way left
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		expect(get(flow).phase).toBe('choosing');
		expect(get(flow).method).toBeUndefined();
		// And the one that cannot be used is still listed, with its reason: the
		// other half of the same explanation.
		expect(get(flow).methods).toHaveLength(2);
		expect(
			get(flow).methods.find((m) => m.id === 'account')?.unavailableReason,
		).toBeTruthy();
	});

	it('explains itself when NOTHING can pay, rather than showing a dead button', async () => {
		// A hosted account meeting a browser with no wallet: it cannot send, and
		// there is no wallet to pay with. Real and reachable, not a bug.
		const {flowDeps} = deps({
			payerBalance: 0n,
			accountBalance: 0n,
			ownerCanSend: false,
			ownerHasWallet: false,
			savedDelegationSignature: SAVED_SIGNATURE,
			walletsAvailable: 0,
			allowed: false,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		const state = get(flow);
		expect(state.phase).toBe('unavailable');
		expect(state.open).toBe(true);
		expect(state.explanation).toContain('no way to pay');
	});

	it('closes the signature route once the account has withdrawn this signer', async () => {
		// The withdrawn flag is per delegate: cleared only by an owner-sent
		// registerDelegate, so paying with another wallet could only produce a
		// revert for the signer that was withdrawn.
		const {flowDeps} = deps({
			payerBalance: ETH,
			accountBalance: ETH,
			allowed: false,
			withdrawn: true,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		const wallet = get(flow).methods.find((m) => m.id === 'wallet');
		expect(wallet?.available).toBe(false);
		expect(wallet?.unavailableReason).toContain('withdrew');
		expect(get(flow).methods.find((m) => m.id === 'account')?.available).toBe(
			true,
		);
	});
});

describe('createTopUpFlow: which step the payer lands on', () => {
	it('opens ready to send, at the price of a top-up, when the payer has funds', async () => {
		const {flowDeps} = deps({payerBalance: ETH, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		const state = get(flow);
		expect(state.phase).toBe('ready');
		expect(state.payer).toBe(PAYER);
		expect(state.value).toBe(topUpCeiling(CREDITS));
		expect(state.creditsText).toBe('100');
	});

	it('offers the faucet instead when the payer cannot send anything', async () => {
		// The whole reason the flow exists: on a local chain the account chosen in
		// the wallet is routinely empty, and the old UI answered that with a
		// disabled button and a shortfall message.
		const {flowDeps} = deps({payerBalance: 0n, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).phase).toBe('empty');
		expect(get(flow).payer).toBe(PAYER);
	});

	it('treats dust that cannot cover gas as empty, not as a tiny top-up', async () => {
		const {flowDeps} = deps({payerBalance: TRANSFER_COST, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).phase).toBe('empty');
	});

	it('says nothing about credits when the chain does not price actions', async () => {
		const {flowDeps} = deps({payerBalance: ETH});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).creditsText).toBeUndefined();
		expect(get(flow).value).toBe(DEFAULT_TOP_UP_CEILING);
	});
});

describe('createTopUpFlow: sending', () => {
	it('sends the whole top-up from the payer to the signer', async () => {
		const {flowDeps, sendTransaction} = deps({
			payerBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		await flow.confirm();

		expect(sendTransaction).toHaveBeenCalledWith({
			account: PAYER,
			to: SIGNER,
			value: topUpCeiling(CREDITS),
		});
		// Closed again, because what the user opened it for is done.
		expect(get(flow).phase).toBe('idle');
	});

	it('sends from the account itself when that is the method chosen', async () => {
		// One transaction, one wallet prompt, no second connection.
		const {flowDeps, accountSendTransaction, sendTransaction} = deps({
			payerBalance: ETH,
			accountBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('account');
		expect(get(flow).payer).toBe(OWNER);
		await flow.confirm();

		expect(accountSendTransaction).toHaveBeenCalled();
		expect(sendTransaction).not.toHaveBeenCalled();
		expect(get(flow).phase).toBe('idle');
	});

	it('tells the balance check to watch for the money, so a blocked transaction can resume', async () => {
		// This is what makes "Send -> no funds -> top up -> continue" one flow
		// rather than two: the transaction waiting on the signer's balance is
		// resumed by watching that balance change, from the value it had BEFORE.
		const {flowDeps, markFundingRequested} = deps({
			payerBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		await flow.confirm();

		expect(markFundingRequested).toHaveBeenCalledWith(7n);
	});

	it('does not send, and does not close, when signed out', async () => {
		const {flowDeps, sendTransaction} = deps({
			payerBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);
		await flow.start();
		await flow.choose('wallet');
		// Signing out between opening the modal and confirming: the signer address
		// it would have sent to no longer exists.
		(flowDeps.connection as unknown as {set: (v: unknown) => void}).set({
			step: 'WalletConnected',
		});

		await flow.confirm();

		expect(sendTransaction).not.toHaveBeenCalled();
		expect(get(flow).error).toContain('Signed out');
	});
});

describe('createTopUpFlow: the first top-up is the registration', () => {
	/** Nothing is registered yet, which is where every new signer starts. */
	const unregistered = (extra: Partial<DepsParams> = {}) =>
		deps({
			payerBalance: ETH,
			accountBalance: ETH,
			credits: CREDITS,
			allowed: false,
			...extra,
		});

	it('registers and funds in ONE transaction when the account pays', async () => {
		const {flowDeps, accountWriteContract, accountSendTransaction} =
			unregistered();
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		expect(get(flow).registering).toBe(true);
		await flow.choose('account');
		expect(get(flow).route).toBe('direct');
		await flow.confirm();

		// The owner sends, so sending IS the proof and no signature exists.
		expect(accountWriteContract).toHaveBeenCalledTimes(1);
		const call = accountWriteContract.mock.calls[0][0];
		expect(call.functionName).toBe('registerDelegate');
		// payee is the delegate, never the zero address: Payments.forward reverts
		// on value with a zero payee.
		expect(call.args).toEqual([SIGNER, SIGNER]);
		expect(call.value).toBeGreaterThan(0n);
		// Not a separate transfer alongside it: that is the point of `payee`.
		expect(accountSendTransaction).not.toHaveBeenCalled();
	});

	it('keeps back a contract call worth of gas, not a transfer worth', async () => {
		const {flowDeps} = unregistered({accountBalance: topUpCeiling(CREDITS)});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('account');

		expect(get(flow).value).toBe(topUpCeiling(CREDITS) - REGISTRATION_COST);
	});

	it('uses the pre-generated credential when the connection carries one', async () => {
		// Detected by the credential BEING there for THIS contract, not by
		// inferring an account type.
		const {flowDeps, paymentWriteContract, signMessage} = unregistered({
			savedDelegationSignature: SAVED_SIGNATURE,
			savedDeadline: 1893456000,
			ownerCanSend: false,
			ownerHasWallet: false,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		expect(get(flow).route).toBe('pre-signed');

		await flow.confirm();

		// Nothing to prompt: no consent step, no signature request.
		expect(signMessage).not.toHaveBeenCalled();
		const call = paymentWriteContract.mock.calls[0][0];
		expect(call.functionName).toBe('registerDelegateViaSignature');
		// The deadline that was SIGNED travels with the signature: the contract
		// cannot know it otherwise, and a wrong one recovers a different address.
		expect(call.args).toEqual([OWNER, SIGNER, 1893456000n, SAVED_SIGNATURE]);
	});

	it('ignores a credential minted for a DIFFERENT contract', async () => {
		// The contract's own address is inside the signed bytes, so a credential
		// for another contract is worth nothing here. Submitting it would spend the
		// user's money on a transaction that cannot succeed.
		const {flowDeps} = unregistered({
			savedDelegationSignature: SAVED_SIGNATURE,
			ownerCanSend: false,
			ownerHasWallet: false,
		});
		// Move the stored record to another contract, leaving the read (and so the
		// write) pointed where it was.
		const account = (
			get(flowDeps.connection) as unknown as {
				account: {savedDelegations: {contract: string}[]};
			}
		).account;
		account.savedDelegations[0].contract =
			'0x00000000000000000000000000000000000000ff';
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		// Nothing to submit and nobody to ask, so the remedy is a fresh sign-in.
		expect(get(flow).phase).toBe('re-authorise');
		expect(get(flow).route).toBe('re-authorise');
	});

	it('sends a hosted account back to sign in when it was DENIED, and says so', async () => {
		// A denial has to be REPORTED, not merely reflected in a missing
		// credential: "you declined" and "nobody asked" call for different
		// sentences, and an absent record says neither.
		const {flowDeps} = unregistered({
			ownerCanSend: false,
			ownerHasWallet: false,
			permissions: [
				{
					request: {
						type: 'delegation',
						required: false,
						chainId: CHAIN_ID,
						contract: REGISTRY,
					},
					granted: false,
					reason: 'denied',
				},
			],
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).phase).toBe('re-authorise');
		expect(get(flow).explanation).toContain('declined');
	});

	it('signs in again on the remedy, and carries on with the fresh credential', async () => {
		// THE REMEDY the re-authorise route exists for: a hosted account mints its
		// credentials at sign-in, so the way to get another is to sign in again.
		// Driven from a button, which is a user gesture and therefore popup-safe.
		const FRESH = `0x${'ef'.repeat(65)}` as const;
		const {flowDeps} = unregistered({
			ownerCanSend: false,
			ownerHasWallet: false,
			permissions: [
				{
					request: {
						type: 'delegation',
						required: false,
						chainId: CHAIN_ID,
						contract: REGISTRY,
					},
					granted: false,
					reason: 'denied',
				},
			],
			credentialAfterSignIn: FRESH,
		});
		const connection = flowDeps.connection as unknown as {
			disconnect: {mock: {calls: unknown[]}};
			ensureConnected: {mock: {calls: unknown[]}};
		};
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		expect(get(flow).phase).toBe('re-authorise');

		await flow.reauthorise();

		// Signed OUT first, because a connection that is already signed in has
		// nothing to mint.
		expect(connection.disconnect.mock.calls).toHaveLength(1);
		expect(connection.ensureConnected.mock.calls).toHaveLength(1);
		// And back where the user was, now with something to submit.
		expect(get(flow).phase).toBe('ready');
		expect(get(flow).route).toBe('pre-signed');
	});

	it('says the user is signed out when they back out of that sign-in', async () => {
		// The one thing about that button that can leave someone worse off than
		// before pressing it, so it is not left to be discovered from a screen
		// that still names their account.
		const {flowDeps} = unregistered({
			ownerCanSend: false,
			ownerHasWallet: false,
		});
		const connection = flowDeps.connection as unknown as {
			ensureConnected: {mockRejectedValueOnce: (e: unknown) => void};
		};
		connection.ensureConnected.mockRejectedValueOnce(
			Object.assign(new Error('User rejected the request'), {code: 4001}),
		);
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		await flow.reauthorise();

		expect(get(flow).phase).toBe('re-authorise');
		expect(get(flow).error).toContain('signed out');
	});

	it('treats a credential the contract refuses as one to replace, not an error', async () => {
		// Every field stored beside the signature is a copy of what is inside it,
		// so a disagreement cannot be noticed until the contract fails to recover
		// the owner. That is not a contract error to report, it is a credential to
		// throw away - which is what makes the mismatch self-healing.
		const {flowDeps, paymentWriteContract} = unregistered({
			savedDelegationSignature: SAVED_SIGNATURE,
			ownerCanSend: false,
			ownerHasWallet: false,
		});
		paymentWriteContract.mockRejectedValueOnce(
			Object.assign(new Error('execution reverted'), {
				cause: {data: {errorName: 'InvalidSignature'}},
			}),
		);
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		await flow.confirm();

		expect(get(flow).phase).toBe('re-authorise');
		expect(get(flow).error).toBeUndefined();

		// AND IT STICKS. The record belongs to the wallet and the app cannot
		// delete it, so without remembering the refusal, backing out and starting
		// again would pick the same doomed credential and fail the same way.
		await flow.cancel();
		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).phase).toBe('re-authorise');
		expect(paymentWriteContract).toHaveBeenCalledTimes(1);
	});

	it('explains the authorisation BEFORE asking the wallet to sign it', async () => {
		const {flowDeps, signMessage, paymentWriteContract} = unregistered();
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		// The confirm step carries the explanation, because it is the step
		// immediately before the wallet opens. Nothing has been touched yet: the
		// user reads what they are about to sign and then acts, in one step
		// rather than reading, clicking, and acting.
		expect(get(flow).phase).toBe('ready');
		expect(get(flow).route).toBe('live-signature');
		expect(signMessage).not.toHaveBeenCalled();
		expect(paymentWriteContract).not.toHaveBeenCalled();

		await flow.confirm();

		expect(signMessage).toHaveBeenCalledTimes(1);
		const [message, address] = signMessage.mock.calls[0];
		// The exact text the contract verifies, built by the library it is pinned
		// against: the delegate, the contract and the chain, all lowercased as the
		// contract renders them. No origin - the wallet always knows the true one.
		expect(message).toContain(SIGNER.toLowerCase());
		expect(message).toContain(REGISTRY.toLowerCase());
		expect(message).toContain(`Chain ID: ${CHAIN_ID}`);
		expect(message).not.toContain('Origin:');
		expect(address).toBe(OWNER);

		const call = paymentWriteContract.mock.calls[0][0];
		expect(call.functionName).toBe('registerDelegateViaSignature');
		// A PROMPTED credential carries no deadline: renewing one costs a popup and
		// re-consent in the middle of what the user was doing. Dates are for the
		// auto-signed ones, which are minted with nobody in the loop.
		expect(call.args).toEqual([OWNER, SIGNER, 0n, LIVE_SIGNATURE]);
	});

	it('collapses to a direct registration when the payer IS the owner', async () => {
		// Nothing stops the user pointing the payment rail at the account they
		// signed in as. Asking them to sign a message authorising a key and then
		// to send a transaction from that same account is asking twice for one
		// decision.
		const {flowDeps, paymentWriteContract, signMessage} = unregistered({
			payer: OWNER,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).route).toBe('direct');

		await flow.confirm();

		expect(signMessage).not.toHaveBeenCalled();
		const call = paymentWriteContract.mock.calls[0][0];
		expect(call.functionName).toBe('registerDelegate');
		expect(call.args).toEqual([SIGNER, SIGNER]);
	});

	it('does NOT collapse when the owner cannot send, whatever the addresses say', async () => {
		// A hosted account holds no wallet, so it can never be the payer - but the
		// guard is on being able to send, not on the addresses matching.
		const {flowDeps} = unregistered({
			payer: OWNER,
			ownerCanSend: false,
			ownerHasWallet: false,
			savedDelegationSignature: SAVED_SIGNATURE,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).route).toBe('pre-signed');
	});

	it('does an ordinary transfer once the signer is already a delegate', async () => {
		const {flowDeps, sendTransaction, paymentWriteContract} = deps({
			payerBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		expect(get(flow).registering).toBe(false);
		await flow.choose('wallet');
		await flow.confirm();

		expect(paymentWriteContract).not.toHaveBeenCalled();
		expect(sendTransaction).toHaveBeenCalled();
	});
});

describe('createTopUpFlow: the faucet step', () => {
	it('refuses to claim when no faucet is configured, rather than pretending', async () => {
		const {flowDeps} = deps({payerBalance: 0n, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, {...CONFIG, hasFaucet: false});

		await flow.start();
		await flow.choose('wallet');
		await flow.claim();

		expect(get(flow).phase).toBe('empty');
		expect(get(flow).error).toContain('No faucet');
	});

	it('reports what the faucet actually said when it refuses', async () => {
		// A faucet refuses for ordinary reasons: one claim per address and per IP
		// per day, a recipient already holding enough, a popup simply closed.
		// Swallowing that told the user the claim had completed and then blamed the
		// balance for being empty, which sent them round a loop of re-reading a
		// figure that was never going to change.
		const {flowDeps} = deps({payerBalance: 0n, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, {
			...CONFIG,
			faucetApi: 'http://faucet.test',
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				statusText: 'Too Many Requests',
				json: async () => ({error: 'already claimed today'}),
			})),
		);

		await flow.start();
		await flow.choose('wallet');
		await flow.claim();

		const state = get(flow);
		expect(state.phase).toBe('empty');
		expect(state.error).toContain('already claimed today');
		// Still offering the CLAIM, not a Continue that re-reads an untouched
		// balance: nothing was dispensed, so there is nothing new to read.
		expect(state.claimed).toBe(false);

		vi.unstubAllGlobals();
	});

	it('funds the account the modal is NAMING, whoever else claims to be paying', async () => {
		// The faucet target used to be re-derived - from the account executor, or by
		// asking the payment connection again - rather than taken from the payer on
		// screen. Any drift between those and the faucet funded an account the user
		// was not looking at, while the modal went on showing an empty one.
		const {flowDeps} = deps({
			payerBalance: 0n,
			dispensed: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, {
			...CONFIG,
			faucetApi: 'http://faucet.test',
		});

		const claimed: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: {body: string}) => {
				claimed.push(JSON.parse(init.body).address);
				return {ok: true, json: async () => ({txHash: '0x' + '11'.repeat(32)})};
			}),
		);

		await flow.start();
		await flow.choose('wallet');
		expect(get(flow).payer).toBe(PAYER);

		// The payment connection now answers with somebody else entirely, which is
		// what asking it again would have picked up.
		(
			flowDeps.payment as unknown as {
				connection: {ensureConnected: () => Promise<unknown>};
			}
		).connection.ensureConnected = async () => ({
			step: 'WalletConnected',
			account: {address: OWNER},
		});

		await flow.claim();

		expect(claimed).toEqual([PAYER]);

		vi.unstubAllGlobals();
	});

	it('funds the authenticated account when that is who is paying', async () => {
		// Reached when the account could pay at the moment it was offered and cannot
		// by the time it is chosen, which is the only way this step is met with the
		// account paying: an account that already holds nothing is not offered.
		const {flowDeps, setAccountBalance} = deps({
			payerBalance: ETH,
			accountBalance: ETH,
			dispensed: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, {
			...CONFIG,
			faucetApi: 'http://faucet.test',
		});

		const claimed: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: {body: string}) => {
				claimed.push(JSON.parse(init.body).address);
				return {ok: true, json: async () => ({txHash: '0x' + '11'.repeat(32)})};
			}),
		);

		await flow.start();
		setAccountBalance(0n);
		await flow.choose('account');
		expect(get(flow).phase).toBe('empty');

		await flow.claim();

		expect(claimed).toEqual([OWNER]);

		vi.unstubAllGlobals();
	});

	it('trusts what the faucet sent over a wallet balance that is behind', async () => {
		// An injected wallet answers eth_getBalance from a cache until it sees a new
		// block, so the read straight after a claim reports the balance from BEFORE
		// it. Believing that told a user who had just been funded that their account
		// was empty, and offered them a Continue that could only re-read the same
		// stale figure.
		const {flowDeps} = deps({
			payerBalance: 0n, // the wallet insists there is still nothing
			dispensed: ETH, // but the faucet's transaction says otherwise
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, {
			...CONFIG,
			faucetApi: 'http://faucet.test',
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({txHash: '0x' + '11'.repeat(32)}),
			})),
		);

		await flow.start();
		await flow.choose('wallet');
		await flow.claim();

		expect(get(flow).phase).toBe('ready');
		expect(get(flow).value).toBe(topUpCeiling(CREDITS));
		// ...and SAYS it is ahead of the read. Sending is safe, but the wallet has
		// to agree before it will sign, and one that is behind shows the old
		// balance and refuses. The user is told, rather than left staring at a
		// wallet claiming they have nothing while the modal insists they do.
		expect(get(flow).fundsPending).toBe(true);

		vi.unstubAllGlobals();
	});

	it('says nothing about a wallet lag when the read already agrees', async () => {
		const {flowDeps} = deps({
			payerBalance: 0n,
			dispensed: ETH,
			credits: CREDITS,
			setBalanceOnClaim: ETH, // the read catches up straight away
		});
		const flow = createTopUpFlow(flowDeps, {
			...CONFIG,
			faucetApi: 'http://faucet.test',
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({txHash: '0x' + '11'.repeat(32)}),
			})),
		);

		await flow.start();
		await flow.choose('wallet');
		await flow.claim();

		expect(get(flow).phase).toBe('ready');
		expect(get(flow).fundsPending).toBe(false);

		vi.unstubAllGlobals();
	});

	it('moves on to the transfer once the fauceted funds arrive', async () => {
		const {flowDeps, setPayerBalance} = deps({
			payerBalance: 0n,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, {
			...CONFIG,
			faucetApi: 'http://faucet.test',
		});

		// The faucet API claim path: respond, and have the money land with it.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				setPayerBalance(ETH);
				return {
					ok: true,
					json: async () => ({txHash: '0x' + '11'.repeat(32)}),
				};
			}),
		);

		await flow.start();
		await flow.choose('wallet');
		expect(get(flow).phase).toBe('empty');

		await flow.claim();

		expect(get(flow).phase).toBe('ready');
		expect(get(flow).value).toBe(topUpCeiling(CREDITS));

		vi.unstubAllGlobals();
	});
});

describe('createTopUpFlow: when connecting a payer fails', () => {
	it('stays open with the reason, because the modal is the only place it shows', async () => {
		const {flowDeps} = deps({payerBalance: ETH, credits: CREDITS});
		(
			flowDeps.payment as unknown as {
				connection: {ensureConnected: () => Promise<unknown>};
			}
		).connection.ensureConnected = async () => {
			throw new Error('no wallet');
		};
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).open).toBe(true);
		expect(get(flow).error).toContain('Could not connect');
	});

	it('closes quietly when the user rejects the wallet prompt', async () => {
		const {flowDeps} = deps({payerBalance: ETH, credits: CREDITS});
		(
			flowDeps.payment as unknown as {
				connection: {ensureConnected: () => Promise<unknown>};
			}
		).connection.ensureConnected = async () => {
			throw Object.assign(new Error('User rejected the request'), {code: 4001});
		};
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).open).toBe(false);
		expect(get(flow).error).toBeUndefined();
	});
});

describe('createTopUpFlow: always asking who pays', () => {
	it('forgets the last wallet before connecting, so the picker always appears', async () => {
		// The payer is whoever is paying THIS time, not the player's identity, so
		// silently reusing the previous choice is wrong here even though it is
		// right for signing in.
		const {flowDeps} = deps({payerBalance: ETH, credits: CREDITS});
		const payment = flowDeps.payment as unknown as {
			connection: {disconnect: ReturnType<typeof vi.fn>};
		};
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(payment.connection.disconnect).toHaveBeenCalled();
	});

	it('connects nothing at all when paying from the account', async () => {
		const {flowDeps} = deps({
			payerBalance: ETH,
			accountBalance: ETH,
			credits: CREDITS,
		});
		const payment = flowDeps.payment as unknown as {
			connection: {
				disconnect: ReturnType<typeof vi.fn>;
				ensureConnected: ReturnType<typeof vi.fn>;
			};
		};
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('account');

		expect(payment.connection.ensureConnected).not.toHaveBeenCalled();
		expect(payment.connection.disconnect).not.toHaveBeenCalled();
	});
});

describe('createTopUpFlow: pricing the reserve', () => {
	it('holds back more than the bare estimate, because the wallet picks the fee', async () => {
		// Reserving exactly what estimateFeesPerGas says produced a top-up the
		// payer could not afford to send, because the wallet adds its own tip and
		// the base fee moves between the estimate and the send.
		const {flowDeps} = deps({payerBalance: topUpCeiling(CREDITS)});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		const value = get(flow).value;
		expect(value).toBe(topUpCeiling(CREDITS) - TRANSFER_COST);
		expect(value + 21_000n * GWEI).toBeLessThan(topUpCeiling(CREDITS));
	});

	it('prefers the 1559 estimate over getGasPrice, which omits the tip', async () => {
		const {flowDeps} = deps({payerBalance: ETH});
		const client = (
			flowDeps.payment as unknown as {
				publicClient: {
					estimateFeesPerGas: ReturnType<typeof vi.fn>;
					getGasPrice: ReturnType<typeof vi.fn>;
				};
			}
		).publicClient;
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(client.estimateFeesPerGas).toHaveBeenCalled();
		expect(client.getGasPrice).not.toHaveBeenCalled();
	});
});

describe('createTopUpFlow: a wallet that holds one account at a time', () => {
	/**
	 * Rabby exposes exactly one account through `eth_accounts`, so picking a
	 * different payer means switching account in the wallet - and the wallet is
	 * then no longer on the account that has to SIGN. Neither failure announces
	 * itself: a signature comes back from the wrong key, and a transaction is
	 * refused, both as an opaque wallet error.
	 */
	const unregistered = (extra: Partial<DepsParams> = {}) =>
		deps({
			payerBalance: ETH,
			accountBalance: ETH,
			credits: CREDITS,
			allowed: false,
			...extra,
		});

	it('stops and names the account to switch back to, instead of signing with the wrong one', async () => {
		const {flowDeps, signMessage} = unregistered({
			// The user switched to the payer to choose it, so the wallet will now only
			// act as the payer - including when asked to sign as the owner.
			ownerWalletAccounts: [PAYER],
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		await flow.confirm();

		const state = get(flow);
		expect(state.phase).toBe('switch-account');
		expect(state.switchReason).toBe('sign');
		expect(state.switchTo).toBe(OWNER);
		expect(state.switchFrom).toBe(PAYER);
		// Nothing was signed by the wrong key.
		expect(signMessage).not.toHaveBeenCalled();
	});

	it('signs once the wallet is back on the owner, and does not ask twice', async () => {
		const {flowDeps, signMessage, paymentWriteContract} = unregistered({
			ownerWalletAccounts: [PAYER],
			// ...and the payment wallet is left on the owner after that switch, so the
			// transaction cannot go out either until it is switched back.
			payerWalletAccounts: [OWNER],
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		await flow.confirm();
		expect(get(flow).switchReason).toBe('sign');

		// The user switches back to the owner and continues.
		setWalletAccounts(flowDeps, 'owner', [OWNER]);
		await flow.retry();

		// Signed, and now stopped on the OTHER side of the same problem: the payer
		// has to be selected before its transaction can be sent.
		expect(signMessage).toHaveBeenCalledTimes(1);
		expect(get(flow).phase).toBe('switch-account');
		expect(get(flow).switchReason).toBe('pay');
		expect(get(flow).switchTo).toBe(PAYER);
		expect(paymentWriteContract).not.toHaveBeenCalled();

		// Switch to the payer and continue: the signature already in hand is used
		// rather than asked for again.
		setWalletAccounts(flowDeps, 'payer', [PAYER]);
		await flow.retry();

		expect(signMessage).toHaveBeenCalledTimes(1);
		expect(paymentWriteContract).toHaveBeenCalledTimes(1);
		expect(paymentWriteContract.mock.calls[0][0].functionName).toBe(
			'registerDelegateViaSignature',
		);
	});

	it('says nothing about switching when the wallet offers every account at once', async () => {
		// MetaMask exposes every account the user connected, so switching the ACTIVE
		// one changes nothing about what it will sign or send. Here it is active on
		// the payer, having just been used to pick it, and neither the signature nor
		// the transaction needs anything from the user.
		const {flowDeps, signMessage, paymentWriteContract} = unregistered({
			ownerWalletAccounts: [PAYER, OWNER],
			ownerWalletActive: PAYER,
			payerWalletAccounts: [PAYER, OWNER],
			payerWalletActive: PAYER,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');
		await flow.confirm();

		expect(get(flow).phase).not.toBe('switch-account');
		expect(signMessage).toHaveBeenCalledTimes(1);
		expect(paymentWriteContract).toHaveBeenCalledTimes(1);
	});
});

describe('createTopUpFlow: not losing a run to a stray click', () => {
	const unregistered = (extra: Partial<DepsParams> = {}) =>
		deps({
			payerBalance: ETH,
			credits: CREDITS,
			allowed: false,
			...extra,
		});

	it('refuses a dismissal while a wallet is being waited on', async () => {
		// A wallet opens in its own window and takes the focus, so the first click
		// back on the page lands outside the dialog - which the dialog reads as
		// "close me". That tore down a run that had already asked the user to sign:
		// the signature arrived to an abandoned flow and was dropped, no transaction
		// was sent, and nothing on screen said why.
		const {flowDeps, signMessage, paymentWriteContract} = unregistered();
		const flow = createTopUpFlow(flowDeps, CONFIG);

		// Signing takes a while, and the stray click lands in the middle of it.
		let releaseSignature: (() => void) | undefined;
		signMessage.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => (releaseSignature = resolve));
			return LIVE_SIGNATURE;
		});

		await flow.start();
		await flow.choose('wallet');
		const signing = flow.confirm();
		await vi.waitFor(() => expect(get(flow).phase).toBe('sending'));

		flow.dismiss();
		expect(get(flow).open).toBe(true);

		releaseSignature?.();
		await signing;

		// The signature was used for what it was granted for.
		expect(paymentWriteContract).toHaveBeenCalledTimes(1);
	});

	it('still closes on a dismissal when nothing is in flight', async () => {
		// The refusal is about a wallet request being open, not about making the
		// modal hard to get out of.
		const {flowDeps} = unregistered();
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		expect(get(flow).phase).toBe('choosing');

		flow.dismiss();

		expect(get(flow).open).toBe(false);
	});

	it('asks before giving up on a request the wallet may still act on', async () => {
		// Cancelling HERE does not cancel it THERE. The request stays in the wallet,
		// and approving it afterwards still goes through - only now the app has
		// stopped watching. Here that means a registration nobody accounted for; in
		// a game whose move is a commit it means a commit on chain that the app does
		// not know it has to reveal.
		const {flowDeps, asking, signMessage} = unregistered();
		const flow = createTopUpFlow(flowDeps, CONFIG);
		signMessage.mockImplementationOnce(
			() => new Promise(() => {}) as Promise<`0x${string}`>,
		);

		await flow.start();
		await flow.choose('wallet');
		void flow.confirm();
		await vi.waitFor(() => expect(get(flow).phase).toBe('sending'));

		void flow.cancel();
		await vi.waitFor(() => expect(asking().step).toBe('asking'));
		expect(asking().destructive).toBe(true);

		// Thinking better of it leaves the run exactly where it was.
		asking().onCancel();
		await vi.waitFor(() => expect(get(flow).phase).toBe('sending'));
		expect(get(flow).open).toBe(true);

		// Meaning it stops the run.
		void flow.cancel();
		await vi.waitFor(() => expect(asking().step).toBe('asking'));
		asking().onConfirm();
		await vi.waitFor(() => expect(get(flow).open).toBe(false));
	});

	it('takes the question back when the wallet answers while it is up', async () => {
		// The question was about a request that is no longer outstanding, so leaving
		// it on screen would invite an answer to a situation that has moved on.
		const {flowDeps, asking, signMessage} = unregistered();
		const flow = createTopUpFlow(flowDeps, CONFIG);

		let releaseSignature: (() => void) | undefined;
		signMessage.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => (releaseSignature = resolve));
			return LIVE_SIGNATURE;
		});

		await flow.start();
		await flow.choose('wallet');
		const run = flow.confirm();
		await vi.waitFor(() => expect(get(flow).phase).toBe('sending'));

		void flow.cancel();
		await vi.waitFor(() => expect(asking().step).toBe('asking'));

		releaseSignature?.();
		await run;

		expect(get(flowDeps.confirmation).step).toBe('idle');
	});

	it('closes immediately when nothing is with the wallet', async () => {
		// With no request outstanding there is nothing to be unsure about, so Cancel
		// must not put a question in the way.
		const {flowDeps, asking} = unregistered();
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.cancel();

		expect(get(flow).open).toBe(false);
		expect(asking().step).toBe('idle');
	});
});

describe('createTopUpFlow: what the confirm step promises', () => {
	const unregistered = (extra: Partial<DepsParams> = {}) =>
		deps({
			payerBalance: ETH,
			credits: CREDITS,
			allowed: false,
			...extra,
		});

	it('promises a wallet prompt for a wallet that prompts', async () => {
		const {flowDeps} = unregistered({walletName: 'MetaMask'});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).phase).toBe('ready');
		expect(get(flow).silentSigner).toBe(false);
	});

	it('does not promise one for the dev wallet, which signs silently', async () => {
		// The burner keeps its key in this browser and signs without showing
		// anything, so "your wallet will ask you to sign" leaves the user waiting
		// for a window that never opens.
		const {flowDeps} = unregistered({walletName: 'Burner Wallet'});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();
		await flow.choose('wallet');

		expect(get(flow).phase).toBe('ready');
		expect(get(flow).silentSigner).toBe(true);
	});
});

describe('createTopUpFlow: the payer changing under the modal', () => {
	/** A wallet like Rabby exposes one account at a time; switching is a store update. */
	function switchAccountTo(flowDeps: TopUpFlowDeps, address: `0x${string}`) {
		(
			flowDeps.payment as unknown as {
				connection: {set: (v: unknown) => void};
			}
		).connection.set({step: 'WalletConnected', account: {address}});
	}

	const OTHER = '0x00000000000000000000000000000000000000cC' as const;

	it('follows the wallet to the new account, and re-prices from ITS balance', async () => {
		const {flowDeps, setPayerBalance} = deps({
			payerBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);
		await flow.start();
		await flow.choose('wallet');
		expect(get(flow).payer).toBe(PAYER);

		// The new account holds less than a full top-up.
		setPayerBalance(topUpCeiling(CREDITS));
		switchAccountTo(flowDeps, OTHER);
		await vi.waitFor(() => expect(get(flow).payer).toBe(OTHER));

		expect(get(flow).value).toBe(topUpCeiling(CREDITS) - TRANSFER_COST);
	});

	it('adopts the account the wallet switched to, which the library does NOT adopt itself', async () => {
		// On an account change the connection keeps the OLD account and records the
		// new one as wallet.accountChanged. Nothing adopts it unless the app does,
		// which is why the modal used to go on naming the previous account.
		const {flowDeps} = deps({payerBalance: ETH, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, CONFIG);
		await flow.start();
		await flow.choose('wallet');

		const connection = (
			flowDeps.payment as unknown as {
				connection: {
					set: (v: unknown) => void;
					connectToAddress: ReturnType<typeof vi.fn>;
				};
			}
		).connection;
		connection.set({
			step: 'WalletConnected',
			account: {address: PAYER},
			wallet: {accountChanged: OTHER},
		});

		await vi.waitFor(() => expect(get(flow).payer).toBe(OTHER));
		expect(connection.connectToAddress).toHaveBeenCalledWith(OTHER);
	});

	it('refuses to send an amount sized for a different account', async () => {
		const {flowDeps, sendTransaction} = deps({
			payerBalance: ETH,
			credits: CREDITS,
		});
		const flow = createTopUpFlow(flowDeps, CONFIG);
		await flow.start();
		await flow.choose('wallet');

		// Switch without letting the watcher run, i.e. the same-tick race.
		(
			flowDeps.payment as unknown as {connection: {set: (v: unknown) => void}}
		).connection.set({step: 'WalletConnected', account: {address: OTHER}});
		await flow.confirm();

		expect(sendTransaction).not.toHaveBeenCalled();
		expect(get(flow).payer).toBe(OTHER);
	});
});
