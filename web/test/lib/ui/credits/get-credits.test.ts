import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {
	checkPayerFunds,
	fundSignerFromAccount,
	getCredits,
	TRANSFER_GAS,
} from '$lib/ui/credits/get-credits';
import type {
	FundFromAccountDeps,
	GetCreditsDeps,
} from '$lib/ui/credits/get-credits';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const PAYER = '0x00000000000000000000000000000000000000bB' as const;

type Overrides = {
	ensureConnected?: () => Promise<unknown>;
	sendTransaction?: (...args: never[]) => Promise<unknown>;
};

function deps(over: Overrides = {}) {
	const sendTransaction = vi.fn(async () => '0xhash' as `0x${string}`);
	const ensureConnected = vi.fn(async () => ({account: {address: PAYER}}));
	const update = vi.fn(async () => ({step: 'Unloaded'}) as never);

	const payment = {
		connection: {ensureConnected: over.ensureConnected ?? ensureConnected},
		walletClient: {sendTransaction: over.sendTransaction ?? sendTransaction},
		// Plenty, so the funds check passes and the tests below exercise what
		// they are actually about.
		publicClient: {
			getBalance: async () => 10n ** 21n,
			getGasPrice: async () => 1_000_000_000n,
		},
	};

	const d = {
		payment,
		signerBalance: {
			...writable({step: 'Unloaded'}),
			status: writable({}),
			update,
		},
	} as unknown as GetCreditsDeps;

	return {deps: d, sendTransaction, ensureConnected, update, payment};
}

describe('getCredits', () => {
	it('pays from the payment connection, to the signer', async () => {
		const {deps: d, sendTransaction, ensureConnected} = deps();

		const result = await getCredits(d, {to: SIGNER, value: 1234n});

		expect(result).toEqual({status: 'bought'});
		// The payer is whoever the payment wallet is, NOT the player's account.
		expect(sendTransaction).toHaveBeenCalledWith({
			account: PAYER,
			to: SIGNER,
			value: 1234n,
			metadata: {type: 'unknown', name: 'topUp', data: []},
		});
		expect(ensureConnected).toHaveBeenCalled();
	});

	it('names the payment the same way whichever wallet paid', async () => {
		// The rail's client is TRACKED (see context/core), so what goes through it
		// becomes an operation in the user's transaction list. Only `writeContract`
		// auto-populates metadata; a transfer has no function name to read one from,
		// so a payment sent without any is filed nameless, which is barely better
		// than the state this replaced, where it was not filed at all.
		//
		// And the SAME name as paying from the account, because these are the two
		// ways of paying for one thing: which wallet the user picked is not a
		// difference their transaction list should show.
		type Sent = {metadata?: {name?: string}};
		const viaRail: Sent[] = [];
		const viaAccount: Sent[] = [];

		const {deps: d} = deps({
			sendTransaction: (async (args: Sent) => {
				viaRail.push(args);
				return '0xhash';
			}) as never,
		});
		await getCredits(d, {to: SIGNER, value: 1n});

		await fundSignerFromAccount(
			{
				accountExecutor: writable({
					status: 'ready',
					address: PAYER,
					account: PAYER,
					client: {
						sendTransaction: async (args: Sent) => {
							viaAccount.push(args);
							return '0xhash';
						},
					},
				}),
			} as unknown as FundFromAccountDeps,
			{to: SIGNER, value: 1n},
		);

		expect(viaRail[0]?.metadata?.name).toBeTruthy();
		expect(viaRail[0]?.metadata?.name).toBe(viaAccount[0]?.metadata?.name);
	});

	it('refreshes the balance the user is watching', async () => {
		const {deps: d, update} = deps();
		await getCredits(d, {to: SIGNER, value: 1n});
		expect(update).toHaveBeenCalled();
	});

	it('reports a rejected wallet prompt as cancelled, not as an error', async () => {
		const {deps: d} = deps({
			sendTransaction: vi.fn(async () => {
				throw Object.assign(new Error('User rejected the request.'), {
					code: 4001,
				});
			}),
		});

		expect(await getCredits(d, {to: SIGNER, value: 1n})).toEqual({
			status: 'cancelled',
		});
	});

	it('reports a real failure with text the UI can show', async () => {
		const {deps: d} = deps({
			sendTransaction: vi.fn(async () => {
				throw new Error('insufficient funds for gas * price + value');
			}),
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await getCredits(d, {to: SIGNER, value: 1n});

		expect(result.status).toBe('error');
		expect(result).toHaveProperty('message');
	});

	it('does not send when the payer never connects', async () => {
		const sendTransaction = vi.fn();
		const {deps: d} = deps({
			ensureConnected: vi.fn(async () => {
				throw new Error('no wallet');
			}),
			sendTransaction,
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		expect((await getCredits(d, {to: SIGNER, value: 1n})).status).toBe('error');
		expect(sendTransaction).not.toHaveBeenCalled();
	});

	it('leaves the signer-balance store untouched on failure', async () => {
		const {deps: d, update} = deps({
			sendTransaction: vi.fn(async () => {
				throw new Error('nope');
			}),
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await getCredits(d, {to: SIGNER, value: 1n});
		expect(update).not.toHaveBeenCalled();
	});
});

describe('checkPayerFunds', () => {
	const GWEI = 1_000_000_000n;

	it('accepts an amount the payer can cover with gas to spare', () => {
		expect(
			checkPayerFunds({
				balance: 10n ** 18n,
				value: 10n ** 17n,
				maxFeePerGas: GWEI,
			}),
		).toEqual({ok: true});
	});

	it('rejects sending the entire balance, because gas still has to be paid', () => {
		// The case a user actually hits: type the whole balance, and without this
		// the WALLET is what discovers it, in its own words, in a popup.
		const balance = 10n ** 18n;
		const result = checkPayerFunds({
			balance,
			value: balance,
			maxFeePerGas: GWEI,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.required).toBe(balance + TRANSFER_GAS * GWEI);
			expect(result.balance).toBe(balance);
		}
	});

	it('rejects an amount above the balance', () => {
		expect(
			checkPayerFunds({balance: 1n, value: 10n ** 18n, maxFeePerGas: GWEI}).ok,
		).toBe(false);
	});

	it('accepts exactly the balance minus gas', () => {
		const balance = 10n ** 18n;
		const value = balance - TRANSFER_GAS * GWEI;
		expect(checkPayerFunds({balance, value, maxFeePerGas: GWEI})).toEqual({
			ok: true,
		});
	});

	it('prices a caller-supplied gas limit, for a game whose top-up is a contract call', () => {
		const result = checkPayerFunds({
			balance: 10n ** 18n,
			value: 10n ** 18n - 100_000n * GWEI,
			maxFeePerGas: GWEI,
			gas: 200_000n,
		});
		expect(result.ok).toBe(false);
	});
});

describe('getCredits: refusing before the wallet sees it', () => {
	it('reports insufficient funds without sending', async () => {
		const sendTransaction = vi.fn();
		const {deps: d} = deps({sendTransaction});
		(d as never as {payment: {publicClient: unknown}}).payment.publicClient = {
			getBalance: async () => 1n,
			getGasPrice: async () => 1_000_000_000n,
		};

		const result = await getCredits(d, {to: SIGNER, value: 10n ** 18n});

		expect(result.status).toBe('insufficient');
		expect(sendTransaction).not.toHaveBeenCalled();
	});
});
