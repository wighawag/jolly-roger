import {describe, it, expect} from 'vitest';
import {get} from 'svelte/store';
import {createRpcFaultFlag, wrapProviderWithFault} from '../../../../src/lib/core/connection/rpc-fault';

describe('rpc-fault', () => {
	function makeProvider() {
		let calls = 0;
		return {
			provider: {
				request: async (args: {method: string}) => {
					calls++;
					return `ok:${args.method}`;
				},
				other: 42,
			},
			calls: () => calls,
		};
	}

	it('passes requests through when the flag is off (default)', async () => {
		const flag = createRpcFaultFlag();
		const {provider} = makeProvider();
		const wrapped = wrapProviderWithFault(provider, flag);
		expect(get(flag)).toBe(false);
		await expect(wrapped.request({method: 'eth_blockNumber'})).resolves.toBe('ok:eth_blockNumber');
	});

	it('fails every request while the flag is on, and does not hit the underlying provider', async () => {
		const flag = createRpcFaultFlag();
		const {provider, calls} = makeProvider();
		const wrapped = wrapProviderWithFault(provider, flag);

		flag.set(true);
		await expect(wrapped.request({method: 'eth_getBalance'})).rejects.toThrow(/forced failure/);
		expect(calls()).toBe(0);
	});

	it('recovers when the flag is toggled back off', async () => {
		const flag = createRpcFaultFlag();
		const {provider} = makeProvider();
		const wrapped = wrapProviderWithFault(provider, flag);

		flag.set(true);
		await expect(wrapped.request({method: 'eth_call'})).rejects.toThrow();
		flag.set(false);
		await expect(wrapped.request({method: 'eth_call'})).resolves.toBe('ok:eth_call');
	});

	it('preserves non-request members', () => {
		const flag = createRpcFaultFlag();
		const {provider} = makeProvider();
		const wrapped = wrapProviderWithFault(provider, flag);
		expect((wrapped as unknown as {other: number}).other).toBe(42);
	});
});
