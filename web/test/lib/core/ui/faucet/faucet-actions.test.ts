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

	function deps(markFaucetClaimed = vi.fn()) {
		return {
			deps: {
				accountExecutor: readable({status: 'ready', address: EXECUTOR}),
				accountBalance: {
					...readable({step: 'Loaded', value: 5n}),
					update: vi.fn(),
				},
				deployments: readable({chain: {id: 31337}}),
				publicClient: {waitForTransactionReceipt: vi.fn(async () => ({}))},
				balanceCheck: {markFaucetClaimed},
			} as never,
			markFaucetClaimed,
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

	it('does NOT notify the balance check when a different account was funded', async () => {
		// The balance check polls the EXECUTOR's balance to unblock a stuck
		// transaction. Telling it about a claim made for the payer would leave it
		// waiting for a change that never comes, and then invite the user to
		// continue into the same failure. That exact sequence was a reported bug.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ok: true, json: async () => ({txHash: '0xabc'})})),
		);
		const {deps: d, markFaucetClaimed} = deps();

		await claimFaucet(d, config, PAYER);

		expect(markFaucetClaimed).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('still notifies it when the executor itself was funded', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ok: true, json: async () => ({txHash: '0xabc'})})),
		);
		const {deps: d, markFaucetClaimed} = deps();

		await claimFaucet(d, config);

		expect(markFaucetClaimed).toHaveBeenCalledWith(5n);
		vi.unstubAllGlobals();
	});
});
