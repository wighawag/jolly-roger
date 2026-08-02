import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {get, writable} from 'svelte/store';
import {createSignerBalanceStore} from '$lib/core/connection/signerBalance';
import type {OptionalSigner, Signer} from '$lib/core/connection/types';
import type {PublicClient} from 'viem';

const OWNER = '0x0000000000000000000000000000000000000001' as const;
const SIGNER_A = '0x00000000000000000000000000000000000000aA' as const;
const SIGNER_B = '0x00000000000000000000000000000000000000bB' as const;

function signer(address: `0x${string}`, owner: `0x${string}` = OWNER): Signer {
	return {address, owner, privateKey: '0xkey' as `0x${string}`};
}

function activate<T>(store: {subscribe: (r: (v: T) => void) => () => void}) {
	return store.subscribe(() => {});
}

describe('createSignerBalanceStore (adapter)', () => {
	// Polling stores only poll in a browser (ADR-0002), and this project is Node
	// with no DOM, so declare the global the guard looks for. The off-browser
	// behaviour itself is covered in polling-store.test.ts.
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('loads the signer and owner balances for the current signer', async () => {
		const getBalance = vi.fn(async ({address}: {address: string}) =>
			address === SIGNER_A ? 10n : address === OWNER ? 99n : 0n,
		);
		const publicClient = {getBalance} as unknown as PublicClient;
		const signerStore = writable<OptionalSigner>(signer(SIGNER_A));

		const store = createSignerBalanceStore({publicClient, signer: signerStore});
		const off = activate(store);

		await vi.waitFor(() =>
			expect(get(store)).toEqual({
				step: 'Loaded',
				signer: 10n,
				owner: 99n,
			}),
		);
		// both the signer and the owner address are queried
		expect(getBalance).toHaveBeenCalledWith({address: SIGNER_A});
		expect(getBalance).toHaveBeenCalledWith({address: OWNER});
		off();
	});

	it('refetches when the signer address changes (source-keyed)', async () => {
		const getBalance = vi.fn(async ({address}: {address: string}) => {
			if (address === SIGNER_A) return 1n;
			if (address === SIGNER_B) return 2n;
			return 99n; // owner
		});
		const publicClient = {getBalance} as unknown as PublicClient;
		const signerStore = writable<OptionalSigner>(signer(SIGNER_A));

		const store = createSignerBalanceStore({publicClient, signer: signerStore});
		const off = activate(store);

		await vi.waitFor(() =>
			expect(get(store)).toEqual({
				step: 'Loaded',
				signer: 1n,
				owner: 99n,
			}),
		);

		signerStore.set(signer(SIGNER_B));
		await vi.waitFor(() =>
			expect(get(store)).toEqual({
				step: 'Loaded',
				signer: 2n,
				owner: 99n,
			}),
		);
		expect(getBalance).toHaveBeenCalledWith({address: SIGNER_B});
		off();
	});

	it('resets to Unloaded when the signer clears', async () => {
		const getBalance = vi.fn(async () => 5n);
		const publicClient = {getBalance} as unknown as PublicClient;
		const signerStore = writable<OptionalSigner>(signer(SIGNER_A));

		const store = createSignerBalanceStore({publicClient, signer: signerStore});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store).step).toBe('Loaded'));

		signerStore.set(undefined);
		expect(get(store)).toEqual({step: 'Unloaded'});
		off();
	});

	it('records an error in status when a balance fetch throws', async () => {
		const getBalance = vi.fn(async () => {
			throw new Error('rpc down');
		});
		const publicClient = {getBalance} as unknown as PublicClient;
		const signerStore = writable<OptionalSigner>(signer(SIGNER_A));

		const store = createSignerBalanceStore({publicClient, signer: signerStore});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store.status).error).toBeDefined());
		expect(get(store.status).error?.cause).toBeInstanceOf(Error);
		off();
	});
});
