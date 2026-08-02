import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {get, writable} from 'svelte/store';
import {createBalanceStore} from '$lib/core/connection/balance';
import type {AccountStore} from '$lib/core/connection/types';
import type {PublicClient} from 'viem';

const ADDR_A = '0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA' as const;
const ADDR_B = '0xbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbB' as const;

function activate<T>(store: {subscribe: (r: (v: T) => void) => () => void}) {
	return store.subscribe(() => {});
}

describe('createBalanceStore (adapter)', () => {
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

	it('fetches getBalance for the current account and loads {value}', async () => {
		const getBalance = vi.fn(async () => 42n);
		const publicClient = {getBalance} as unknown as PublicClient;
		const account = writable<`0x${string}` | undefined>(ADDR_A) as AccountStore;

		const store = createBalanceStore({publicClient, account});
		const off = activate(store);

		await vi.waitFor(() =>
			expect(get(store)).toEqual({step: 'Loaded', value: 42n}),
		);
		expect(getBalance).toHaveBeenLastCalledWith({address: ADDR_A});
		off();
	});

	it('refetches for the new address when the account changes', async () => {
		const getBalance = vi.fn(async (args: {address: string}) =>
			args.address === ADDR_A ? 1n : 2n,
		);
		const publicClient = {getBalance} as unknown as PublicClient;
		const account = writable<`0x${string}` | undefined>(ADDR_A);

		const store = createBalanceStore({
			publicClient,
			account: account as AccountStore,
		});
		const off = activate(store);

		await vi.waitFor(() =>
			expect(get(store)).toEqual({step: 'Loaded', value: 1n}),
		);

		account.set(ADDR_B);
		await vi.waitFor(() =>
			expect(get(store)).toEqual({step: 'Loaded', value: 2n}),
		);
		expect(getBalance).toHaveBeenLastCalledWith({address: ADDR_B});
		off();
	});

	it('resets to Unloaded when the account clears', async () => {
		const getBalance = vi.fn(async () => 5n);
		const publicClient = {getBalance} as unknown as PublicClient;
		const account = writable<`0x${string}` | undefined>(ADDR_A);

		const store = createBalanceStore({
			publicClient,
			account: account as AccountStore,
		});
		const off = activate(store);

		await vi.waitFor(() =>
			expect(get(store)).toEqual({step: 'Loaded', value: 5n}),
		);

		account.set(undefined);
		expect(get(store)).toEqual({step: 'Unloaded'});
		off();
	});

	it('records an error in status when getBalance throws', async () => {
		const getBalance = vi.fn(async () => {
			throw new Error('rpc down');
		});
		const publicClient = {getBalance} as unknown as PublicClient;
		const account = writable<`0x${string}` | undefined>(ADDR_A) as AccountStore;

		const store = createBalanceStore({publicClient, account});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store.status).error).toBeDefined());
		expect(get(store.status).error?.cause).toBeInstanceOf(Error);
		off();
	});
});
