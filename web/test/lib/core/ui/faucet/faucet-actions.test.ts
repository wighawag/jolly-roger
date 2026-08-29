import {describe, it, expect, vi} from 'vitest';
import {readable} from 'svelte/store';
import {
	buildFaucetClaimUrl,
	claimFaucet,
	isValidTxHash,
} from '../../../../../src/lib/core/ui/faucet/faucet-actions';

describe('buildFaucetClaimUrl', () => {
	it('appends /api/claim without a trailing slash', () => {
		expect(buildFaucetClaimUrl('https://faucet.example')).toBe(
			'https://faucet.example/api/claim',
		);
	});

	it('tolerates a trailing slash on the base', () => {
		expect(buildFaucetClaimUrl('https://faucet.example/')).toBe(
			'https://faucet.example/api/claim',
		);
	});
});

describe('isValidTxHash', () => {
	it('accepts a 0x-prefixed string', () => {
		expect(isValidTxHash('0xabc')).toBe(true);
	});

	it('rejects non-strings and non-hex', () => {
		expect(isValidTxHash(undefined)).toBe(false);
		expect(isValidTxHash(null)).toBe(false);
		expect(isValidTxHash(123)).toBe(false);
		expect(isValidTxHash('abc')).toBe(false);
	});
});

describe('claimFaucet: funding an account other than the executor', () => {
	const EXECUTOR = '0x0000000000000000000000000000000000000001' as const;
	const PAYER = '0x00000000000000000000000000000000000000bb' as const;

	function deps(markFundingRequested = vi.fn()) {
		return {
			deps: {
				accountExecutor: readable({status: 'ready', address: EXECUTOR}),
				accountBalance: {
					...readable({step: 'Loaded', value: 5n}),
					update: vi.fn(),
				},
				deployments: readable({chain: {id: 31337}}),
				publicClient: {waitForTransactionReceipt: vi.fn(async () => ({}))},
				balanceCheck: {markFundingRequested},
			} as never,
			markFundingRequested,
		};
	}

	const config = {faucetApi: 'https://faucet.example', faucetLink: ''};

	it('claims for the given target instead of the executor', async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({txHash: '0xabc'}),
		}));
		vi.stubGlobal('fetch', fetchMock);
		const {deps: d} = deps();

		await claimFaucet(d, config, PAYER);

		const [, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{body: string},
		];
		const body = JSON.parse(init.body);
		expect(body.address).toBe(PAYER);
		vi.unstubAllGlobals();
	});

	it('reports WHICH account it funded, rather than deciding what that means', async () => {
		// The balance check polls the balance of whatever account a stuck
		// transaction is short on. Telling it about a claim made for the payer,
		// when it is waiting on someone else, leaves it watching for a change that
		// never comes and then inviting the user to continue into the same
		// failure. That exact sequence was a reported bug, and this is still the
		// guarantee - but it is no longer enforced HERE.
		//
		// This used to compare the funded address against the executor and stay
		// silent when they differed, which is a rule that reads "there are two
		// payers and this is not the other one". A third exists (a wallet on the
		// payment rail), and it can be the account a transaction is short on, so
		// that comparison suppressed exactly the notice that was wanted. The rule
		// was never "is this the executor", it is "is this the account the check is
		// blocked on", and only the store knows that. So this reports the address
		// and the store decides: see markFundingRequested in
		// test/lib/core/transaction/balance-check-store.test.ts, which pins both
		// directions.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ok: true, json: async () => ({txHash: '0xabc'})})),
		);
		const {deps: d, markFundingRequested} = deps();

		await claimFaucet(d, config, PAYER);

		expect(markFundingRequested).toHaveBeenCalledWith(PAYER);
		vi.unstubAllGlobals();
	});

	it('names the executor when no target was given', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ok: true, json: async () => ({txHash: '0xabc'})})),
		);
		const {deps: d, markFundingRequested} = deps();

		await claimFaucet(d, config);

		expect(markFundingRequested).toHaveBeenCalledWith(EXECUTOR);
		vi.unstubAllGlobals();
	});

	it('does not re-read the account balance for a claim aimed elsewhere', async () => {
		// It did not change, so the read only spends a request to find that out.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ok: true, json: async () => ({txHash: '0xabc'})})),
		);
		const {deps: d} = deps();

		await claimFaucet(d, config, PAYER);

		expect(
			(d as never as {accountBalance: {update: unknown}}).accountBalance.update,
		).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
