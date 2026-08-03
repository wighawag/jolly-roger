import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {get} from 'svelte/store';
import {createOnchainState} from '$lib/onchain/state';
import type {PublicClient} from 'viem';
import type {TypedDeployments} from '$lib/core/connection/types';

const ADDR = '0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA' as const;

// onchainState only reads deployments.contracts.GreetingsRegistry (spread into
// readContract) so a minimal stub suffices.
const deployments = {
	contracts: {GreetingsRegistry: {address: ADDR, abi: []}},
} as unknown as TypedDeployments;

function activate<T>(store: {subscribe: (r: (v: T) => void) => () => void}) {
	return store.subscribe(() => {});
}

describe('createOnchainState (adapter)', () => {
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

	it('reads getLastMessages(maxMessages) and maps timestamps to ms', async () => {
		const readContract = vi.fn(async () => [
			{account: ADDR, message: 'hi', timestamp: 5n},
		]);
		const publicClient = {readContract} as unknown as PublicClient;

		const store = createOnchainState({
			publicClient,
			deployments,
			config: {maxMessages: 7},
		});
		const off = activate(store);

		await vi.waitFor(() => {
			const v = get(store);
			expect(v.step).toBe('Loaded');
		});

		// contract timestamp (seconds) -> ms
		expect(get(store)).toEqual({
			step: 'Loaded',
			messages: [{account: ADDR, message: 'hi', timestamp: 5000}],
		});
		// maxMessages passed through as bigint arg
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({
				functionName: 'getLastMessages',
				args: [7n],
			}),
		);
		off();
	});

	it('records an error when the read fails', async () => {
		const readContract = vi.fn(async () => {
			throw new Error('revert');
		});
		const publicClient = {readContract} as unknown as PublicClient;

		const store = createOnchainState({
			publicClient,
			deployments,
			config: {maxMessages: 3},
		});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store.status).error).toBeDefined());
		off();
	});
});
