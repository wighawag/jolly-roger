import {writable, type Writable} from 'svelte/store';

/**
 * Debug-only RPC fault injection.
 *
 * A runtime toggle (exposed on the app context, so it is reachable from the
 * browser console as `context.forceRpcFailure`) that makes every RPC request
 * fail while it is set, and succeed again once it is cleared. It wraps the
 * EIP-1193 provider so ALL clients built from it (public, wallet, signer) are
 * affected together, mirroring a real endpoint outage.
 *
 * Intentionally silent: toggling it notifies nothing and logs nothing; it only
 * makes requests fail as they happen. Use it to exercise the RPC-health / retry
 * UI on any deployment:
 *   context.forceRpcFailure.set(true)   // start failing
 *   context.forceRpcFailure.set(false)  // recover
 */
export type RpcFaultFlag = Writable<boolean>;

export function createRpcFaultFlag(): RpcFaultFlag {
	return writable(false);
}

/**
 * Wrap an EIP-1193 provider so that, while `flag` is true, every `request`
 * rejects before reaching the underlying provider. When false, calls pass
 * through unchanged. Non-`request` members are preserved (proxied through).
 *
 * Generic over the provider so the exact (strictly-typed) `request` signature of
 * the connection provider is preserved; the Proxy keeps runtime behavior intact.
 */
export function wrapProviderWithFault<T extends {request: (...args: never[]) => Promise<unknown>}>(
	provider: T,
	flag: {subscribe: RpcFaultFlag['subscribe']},
): T {
	let failing = false;
	flag.subscribe((v) => {
		failing = v;
	});

	return new Proxy(provider, {
		get(target, prop, receiver) {
			if (prop === 'request') {
				return (...args: never[]) => {
					if (failing) {
						// Shape mimics a transport/network failure so it is categorized
						// like a real outage by the rpc-health store.
						return Promise.reject(
							new Error('RPC request failed (forced failure): fetch failed'),
						);
					}
					return (target.request as (...a: never[]) => Promise<unknown>)(...args);
				};
			}
			return Reflect.get(target, prop, receiver);
		},
	});
}
