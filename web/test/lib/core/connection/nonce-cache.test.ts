import {describe, it, expect, vi} from 'vitest';
import {
	detectNonceCache,
	isBlockOutOfRangeError,
	isStrandedNonce,
	readWalletNonce,
	nodeNonceReader,
	type NonceCacheProvider,
} from '../../../../src/lib/core/connection/nonce-cache';

const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;

/** A provider whose `eth_getTransactionCount` returns a fixed value/behaviour. */
function providerReturning(
	fn: (address: string) => Promise<unknown> | unknown,
): NonceCacheProvider {
	return {
		request: async ({method, params}) => {
			if (method !== 'eth_getTransactionCount') throw new Error('unexpected ' + method);
			return fn((params?.[0] as string) ?? '');
		},
	};
}

describe('isBlockOutOfRangeError', () => {
	it('detects MetaMask BlockOutOfRangeError with code -32603', () => {
		expect(
			isBlockOutOfRangeError({code: -32603, message: 'Internal: BlockOutOfRangeError'}),
		).toBe(true);
	});

	it('detects "Received invalid block tag"', () => {
		expect(
			isBlockOutOfRangeError({code: -32603, message: 'Received invalid block tag 999'}),
		).toBe(true);
	});

	it('detects generic "invalid block tag" case-insensitively', () => {
		expect(isBlockOutOfRangeError({message: 'Invalid Block Tag'})).toBe(true);
	});

	it('rejects unrelated errors', () => {
		expect(isBlockOutOfRangeError({code: -32000, message: 'nonce too low'})).toBe(false);
		expect(isBlockOutOfRangeError(new Error('boom'))).toBe(false);
		expect(isBlockOutOfRangeError(undefined)).toBe(false);
		expect(isBlockOutOfRangeError('string')).toBe(false);
	});

	it('rejects a non-internal code even with matching message', () => {
		expect(
			isBlockOutOfRangeError({code: -32000, message: 'BlockOutOfRangeError'}),
		).toBe(false);
	});
});

describe('readWalletNonce', () => {
	it('parses hex and decimal results and takes the max across address casings', async () => {
		const provider = providerReturning((addr) =>
			addr === ADDR.toLowerCase() ? '0x5' : 9, // lowercase=5, checksummed=9
		);
		expect(await readWalletNonce(provider, ADDR)).toEqual({nonce: 9});
	});

	it('flags block-out-of-range when a query rejects with that symptom', async () => {
		const provider = providerReturning(() => {
			throw {code: -32603, message: 'BlockOutOfRangeError'};
		});
		expect(await readWalletNonce(provider, ADDR)).toEqual({blockOutOfRange: true});
	});

	it('ignores an unrelated error on one casing and still returns the other', async () => {
		const provider = providerReturning((addr) => {
			if (addr === ADDR.toLowerCase()) throw new Error('flaky');
			return '0x7';
		});
		expect(await readWalletNonce(provider, ADDR)).toEqual({nonce: 7});
	});

	it('returns undefined nonce when nothing parseable comes back', async () => {
		const provider = providerReturning(() => null);
		expect(await readWalletNonce(provider, ADDR)).toEqual({nonce: undefined});
	});
});

describe('isStrandedNonce', () => {
	it('flags a pending tx whose nonce is above the node pending nonce', () => {
		expect(isStrandedNonce({txNonce: 9, nodePending: 3, pending: true})).toBe(true);
	});

	it('does not flag when the tx nonce equals the node pending nonce', () => {
		expect(isStrandedNonce({txNonce: 3, nodePending: 3, pending: true})).toBe(false);
	});

	it('does not flag a tx below the node pending nonce (already/about to mine)', () => {
		expect(isStrandedNonce({txNonce: 2, nodePending: 3, pending: true})).toBe(false);
	});

	it('never flags a non-pending (mined/dropped) tx', () => {
		expect(isStrandedNonce({txNonce: 9, nodePending: 3, pending: false})).toBe(false);
	});

	it('stays silent when the node pending nonce is unknown', () => {
		expect(isStrandedNonce({txNonce: 9, nodePending: undefined, pending: true})).toBe(
			false,
		);
	});

	it('stays silent when the tx nonce is unknown', () => {
		expect(isStrandedNonce({txNonce: undefined, nodePending: 3, pending: true})).toBe(
			false,
		);
	});
});

describe('detectNonceCache', () => {
	it("returns 'cache' when the wallet nonce is ahead of the node", async () => {
		const provider = providerReturning(() => 11); // wallet at 11
		const status = await detectNonceCache({
			provider,
			address: ADDR,
			readNode: async () => 3, // node at 3
		});
		expect(status).toBe('cache');
	});

	it('returns false when wallet and node agree', async () => {
		const provider = providerReturning(() => 3);
		expect(
			await detectNonceCache({provider, address: ADDR, readNode: async () => 3}),
		).toBe(false);
	});

	it('returns false when the wallet is BEHIND the node (never a cache warning)', async () => {
		const provider = providerReturning(() => 2);
		expect(
			await detectNonceCache({provider, address: ADDR, readNode: async () => 5}),
		).toBe(false);
	});

	it("returns 'block-out-of-range' and never queries the node when the wallet rejects", async () => {
		const provider = providerReturning(() => {
			throw {code: -32603, message: 'Received invalid block tag'};
		});
		const readNode = vi.fn(async () => 3);
		expect(
			await detectNonceCache({provider, address: ADDR, readNode}),
		).toBe('block-out-of-range');
		expect(readNode).not.toHaveBeenCalled();
	});

	it('stays silent (undefined) when the node nonce is unknown', async () => {
		const provider = providerReturning(() => 11);
		expect(
			await detectNonceCache({provider, address: ADDR, readNode: async () => undefined}),
		).toBeUndefined();
	});

	it('stays silent (undefined) when the wallet nonce is unknown', async () => {
		const provider = providerReturning(() => null);
		expect(
			await detectNonceCache({provider, address: ADDR, readNode: async () => 3}),
		).toBeUndefined();
	});
});

describe('nodeNonceReader', () => {
	const origFetch = globalThis.fetch;

	function mockFetch(impl: () => Promise<Response> | Response) {
		globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
	}
	function restore() {
		globalThis.fetch = origFetch;
	}

	it('fetches and parses the pending nonce from the node', async () => {
		mockFetch(
			() =>
				new Response(JSON.stringify({jsonrpc: '2.0', id: 1, result: '0x3'}), {
					status: 200,
				}),
		);
		try {
			expect(await nodeNonceReader('http://node', ADDR)()).toBe(3);
		} finally {
			restore();
		}
	});

	it('returns undefined on a JSON-RPC error', async () => {
		mockFetch(
			() =>
				new Response(JSON.stringify({jsonrpc: '2.0', id: 1, error: {code: -1}}), {
					status: 200,
				}),
		);
		try {
			expect(await nodeNonceReader('http://node', ADDR)()).toBeUndefined();
		} finally {
			restore();
		}
	});

	it('returns undefined on a non-2xx response', async () => {
		mockFetch(() => new Response('nope', {status: 500}));
		try {
			expect(await nodeNonceReader('http://node', ADDR)()).toBeUndefined();
		} finally {
			restore();
		}
	});

	it('returns undefined when fetch throws (network error)', async () => {
		mockFetch(() => {
			throw new Error('ECONNREFUSED');
		});
		try {
			expect(await nodeNonceReader('http://node', ADDR)()).toBeUndefined();
		} finally {
			restore();
		}
	});
});
