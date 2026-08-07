import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {getCredits, resolveTopUpAmount} from '$lib/ui/credits/get-credits';
import type {CreditsConfig} from '$lib/core/connection/credits';
import type {GetCreditsDeps} from '$lib/ui/credits/get-credits';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const PAYER = '0x00000000000000000000000000000000000000bB' as const;

const CREDITS: CreditsConfig = {
	creditUnit: 1_000_000_000n * 100_000n,
	creditsPerTopUp: 100,
};

describe('resolveTopUpAmount: with credits configured', () => {
	it('prices the top-up itself and ignores any typed amount', () => {
		// A credit is a defined thing, so the user is never asked how much a
		// hundred of them cost.
		expect(resolveTopUpAmount(CREDITS, '')).toEqual({
			ok: true,
			value: CREDITS.creditUnit * 100n,
		});
		expect(resolveTopUpAmount(CREDITS, 'nonsense')).toEqual({
			ok: true,
			value: CREDITS.creditUnit * 100n,
		});
	});
});

describe('resolveTopUpAmount: without credits, the user says how much', () => {
	it('parses a decimal amount into wei', () => {
		expect(resolveTopUpAmount(undefined, '0.01')).toEqual({
			ok: true,
			value: 10_000_000_000_000_000n,
		});
	});

	it('tolerates surrounding whitespace', () => {
		expect(resolveTopUpAmount(undefined, '  2  ')).toEqual({
			ok: true,
			value: 2n * 10n ** 18n,
		});
	});

	it('asks for an amount rather than sending nothing', () => {
		expect(resolveTopUpAmount(undefined, '')).toEqual({
			ok: false,
			error: 'Enter an amount',
		});
	});

	it.each(['abc', '1e2', '--1', '1,5'])('rejects %s', (input) => {
		expect(resolveTopUpAmount(undefined, input).ok).toBe(false);
	});

	it('rejects zero and negative amounts', () => {
		expect(resolveTopUpAmount(undefined, '0').ok).toBe(false);
		expect(resolveTopUpAmount(undefined, '-1').ok).toBe(false);
	});

	it('rejects an amount that truncates to nothing', () => {
		// parseUnits silently floors below the smallest unit, which would broadcast
		// a transfer of 0 wei and look like a bug rather than a rejected input.
		expect(resolveTopUpAmount(undefined, '0.0000000000000000001')).toEqual({
			ok: false,
			error: 'Enter an amount above zero',
		});
	});

	it('honours a currency with fewer decimals', () => {
		expect(resolveTopUpAmount(undefined, '1.5', 6)).toEqual({
			ok: true,
			value: 1_500_000n,
		});
	});
});

type Overrides = {
	ensureConnected?: () => Promise<unknown>;
	sendTransaction?: (...args: never[]) => Promise<unknown>;
};

function deps(over: Overrides = {}) {
	const sendTransaction = vi.fn(async () => '0xhash' as `0x${string}`);
	const ensureConnected = vi.fn(async () => ({account: {address: PAYER}}));
	const update = vi.fn(async () => ({step: 'Unloaded'}) as never);

	// Counts how many times the rail was actually BUILT, so the laziness that
	// keeps the payment connection out of the app's wallet discovery is asserted
	// rather than assumed.
	let built = 0;
	let rail: unknown;
	const payment = {
		get() {
			if (!rail) {
				built++;
				rail = {
					connection: {
						ensureConnected: over.ensureConnected ?? ensureConnected,
					},
					walletClient: {
						sendTransaction: over.sendTransaction ?? sendTransaction,
					},
					publicClient: {},
				};
			}
			return rail;
		},
		get materialised() {
			return rail !== undefined;
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

	return {
		deps: d,
		sendTransaction,
		ensureConnected,
		update,
		payment,
		builtCount: () => built,
	};
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
		});
		expect(ensureConnected).toHaveBeenCalled();
	});

	it('refreshes the balance the user is watching', async () => {
		const {deps: d, update} = deps();
		await getCredits(d, {to: SIGNER, value: 1n});
		expect(update).toHaveBeenCalled();
	});

	it('builds the payment rail only when a payment is actually made', async () => {
		// A session that never buys anything should not pay for a second
		// connection, two viem clients and a round of wallet discovery. See
		// core/connection/remote.
		const {deps: d, builtCount, payment} = deps();

		expect(builtCount()).toBe(0);
		expect(payment.materialised).toBe(false);

		await getCredits(d, {to: SIGNER, value: 1n});
		expect(builtCount()).toBe(1);
		expect(payment.materialised).toBe(true);

		// And reused, not rebuilt: a second connection per purchase would raise a
		// fresh wallet prompt every time.
		await getCredits(d, {to: SIGNER, value: 1n});
		expect(builtCount()).toBe(1);
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
