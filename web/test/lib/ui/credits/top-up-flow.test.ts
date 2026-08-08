import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	createTopUpFlow,
	DEFAULT_TOP_UP_CEILING,
	formatAmount,
	maxTopUp,
	spendableBalance,
	topUpCeiling,
	type TopUpFlowDeps,
} from '$lib/ui/credits/top-up-flow';
import type {CreditsConfig} from '$lib/core/connection/credits';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const PAYER = '0x00000000000000000000000000000000000000bB' as const;

const GWEI = 1_000_000_000n;
const ETH = 10n ** 18n;
/** 21000 gas at 1 gwei, doubled: the reserve carries a safety multiplier
 * because the WALLET picks the fee, not us. */
const TRANSFER_COST = 21_000n * GWEI * 2n;

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

function deps(params: {payerBalance: bigint; credits?: CreditsConfig}) {
	const sendTransaction = vi.fn(async () => '0xhash');
	const markFundingRequested = vi.fn();
	const signerBalanceUpdate = vi.fn();
	let payerBalance = params.payerBalance;

	// The payment connection is a STORE as well as an API: the flow watches it so
	// it can follow a wallet that switches account under an open modal.
	const paymentConnection = Object.assign(writable<unknown>({step: 'Idle'}), {
		ensureConnected: vi.fn(async () => {
			const state = {step: 'WalletConnected', account: {address: PAYER}};
			paymentConnection.set(state);
			return state;
		}),
		disconnect: vi.fn(async () => {
			paymentConnection.set({step: 'Idle'});
		}),
		// Adopting an account the wallet switched to. The library exposes this
		// but does NOT call it itself unless `useCurrentAccount` is set.
		connectToAddress: vi.fn(async (address: `0x${string}`) => {
			paymentConnection.set({
				step: 'WalletConnected',
				account: {address},
			});
		}),
	});

	const flowDeps = {
		connection: writable({
			step: 'SignedIn',
			account: {address: SIGNER, signer: {address: SIGNER}},
		}),
		payment: {
			connection: paymentConnection,
			walletClient: {sendTransaction},
			publicClient: {
				getBalance: vi.fn(async () => payerBalance),
				estimateFeesPerGas: vi.fn(async () => ({maxFeePerGas: GWEI})),
				getGasPrice: vi.fn(async () => GWEI),
			},
		},
		signerBalance: Object.assign(writable({step: 'Loaded', value: 7n}), {
			update: signerBalanceUpdate,
		}),
		credits: params.credits,
		// Both a store and a `.get()`: the flow reads it synchronously, while
		// claimFaucet reads it with svelte's `get`. The real one is both.
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
		// Faucet deps, only reached in the empty-payer branch.
		accountExecutor: writable({status: 'ready', address: SIGNER}),
		accountBalance: Object.assign(writable({step: 'Loaded', value: 0n}), {
			update: vi.fn(),
		}),
		publicClient: {waitForTransactionReceipt: vi.fn(async () => ({}))},
		balanceCheck: {markFundingRequested},
	} as unknown as TopUpFlowDeps;

	return {
		flowDeps,
		sendTransaction,
		markFundingRequested,
		setPayerBalance: (value: bigint) => {
			payerBalance = value;
		},
	};
}

const CONFIG = {faucetLink: 'http://faucet.test', hasFaucet: true};

describe('createTopUpFlow: which step the payer lands on', () => {
	it('opens ready to send, at the price of a top-up, when the payer has funds', async () => {
		const {flowDeps} = deps({payerBalance: ETH, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

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

		expect(get(flow).phase).toBe('empty');
		expect(get(flow).payer).toBe(PAYER);
	});

	it('treats dust that cannot cover gas as empty, not as a tiny top-up', async () => {
		const {flowDeps} = deps({payerBalance: TRANSFER_COST, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

		expect(get(flow).phase).toBe('empty');
	});

	it('says nothing about credits when the chain does not price actions', async () => {
		const {flowDeps} = deps({payerBalance: ETH});
		const flow = createTopUpFlow(flowDeps, CONFIG);

		await flow.start();

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
		await flow.confirm();

		expect(sendTransaction).toHaveBeenCalledWith({
			account: PAYER,
			to: SIGNER,
			value: topUpCeiling(CREDITS),
		});
		// Closed again, because what the user opened it for is done.
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

describe('createTopUpFlow: the faucet step', () => {
	it('refuses to claim when no faucet is configured, rather than pretending', async () => {
		const {flowDeps} = deps({payerBalance: 0n, credits: CREDITS});
		const flow = createTopUpFlow(flowDeps, {...CONFIG, hasFaucet: false});

		await flow.start();
		await flow.claim();

		expect(get(flow).phase).toBe('empty');
		expect(get(flow).error).toContain('No faucet');
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

		expect(payment.connection.disconnect).toHaveBeenCalled();
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

		expect(client.estimateFeesPerGas).toHaveBeenCalled();
		expect(client.getGasPrice).not.toHaveBeenCalled();
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

		// Switch without letting the watcher run, i.e. the same-tick race.
		(
			flowDeps.payment as unknown as {connection: {set: (v: unknown) => void}}
		).connection.set({step: 'WalletConnected', account: {address: OTHER}});
		await flow.confirm();

		expect(sendTransaction).not.toHaveBeenCalled();
		expect(get(flow).payer).toBe(OTHER);
	});
});
