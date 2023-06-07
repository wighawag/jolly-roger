import {devProvider} from '$lib/web3';
import {readable, writable, type Readable} from 'svelte/store';

export async function increaseBlockTime(numSeconds: number) {
	if (!devProvider) {
		throw new Error(`no dev provider`);
	}
	const block = await devProvider.request({
		method: 'eth_getBlockByNumber',
		params: ['latest', false],
	});
	if (!block) {
		throw new Error(`no block can be fetched`);
	}
	const old_timestamp = parseInt(block.timestamp.slice(2), 16);
	await devProvider.request({
		method: 'evm_setNextBlockTimestamp',
		params: [`0x` + BigInt(old_timestamp + numSeconds).toString(16)],
	} as any);
	await devProvider.request({
		method: 'evm_mine',
		params: [],
	} as any);
}

export async function enableAnvilLogging() {
	if (!devProvider) {
		throw new Error(`no dev provider`);
	}
	await devProvider.request({
		method: 'anvil_setLoggingEnabled',
		params: [true],
	} as any);
}

// TODO move in promise utitilies
export type Execution<T> = {executing: boolean; error?: any; result?: T};
export function createExecutor<T, F extends (...args: any[]) => Promise<T>>(
	func: F
): Readable<Execution<T>> & {
	execute: F;
	acknowledgeError: () => void;
} {
	const executing = writable<Execution<T>>({executing: false});

	const execute = ((...args: any[]) => {
		executing.set({executing: true, error: undefined, result: undefined});
		return func(...args)
			.then((v) => {
				try {
					executing.set({executing: false, result: v});
				} catch {}
				return v;
			})
			.catch((err) => {
				try {
					executing.set({executing: false, error: err});
				} catch {}
				throw err;
			});
	}) as F;
	return {
		subscribe: executing.subscribe,
		acknowledgeError() {
			executing.set({executing: false, error: undefined, result: undefined});
		},
		execute,
	};
}
