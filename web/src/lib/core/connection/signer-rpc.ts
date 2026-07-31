import type {ExecutionMode} from './mode';

/**
 * Resolve the RPC url a local signer must use to BROADCAST transactions.
 *
 * Signer mode (`PUBLIC_EXECUTION_MODE='signer'`) sends from a local signer, so
 * it needs its own node RPC (`eth_sendRawTransaction`); unlike wallet mode it
 * cannot ride the user's wallet provider. Any real RPC satisfies this: an
 * explicit `PUBLIC_NODE_URL`, or an RPC configured on the chain itself
 * (`rpcUrls.default.http`). Since rocketh no longer bakes in viem's default
 * public RPC, a chain rpcUrl present in the export is a deliberate choice and is
 * a valid source here.
 *
 * Wallet mode does not require any of this (it broadcasts through the wallet),
 * so this resolution is only consulted for signer mode.
 */
export type SignerRpcResolution =
	| {ok: true; rpcUrl: string | undefined}
	| {ok: false; error: string};

function firstNonEmpty(urls: readonly string[] | undefined): string | undefined {
	return urls?.find((url) => url?.trim())?.trim();
}

/**
 * @param executionMode  Resolved execution mode.
 * @param explicitNodeURL `PUBLIC_NODE_URL` (empty/absent => not configured).
 * @param chainRpcUrls    The chain's `rpcUrls.default.http` from the export.
 * @param isDev           `import.meta.env.DEV` (developer-facing vs user-facing
 *   message). Passed in so this stays pure/testable.
 */
export function resolveSignerRpc(
	executionMode: ExecutionMode,
	explicitNodeURL: string | undefined,
	chainRpcUrls: readonly string[] | undefined,
	isDev: boolean,
): SignerRpcResolution {
	const rpcUrl = explicitNodeURL?.trim() || firstNonEmpty(chainRpcUrls);

	// Wallet mode never needs an app-provided RPC (the wallet supplies one), so
	// an absent url is fine; report whatever we have (may be undefined).
	if (executionMode !== 'signer') {
		return {ok: true, rpcUrl};
	}

	if (rpcUrl) {
		return {ok: true, rpcUrl};
	}

	// Signer mode with no RPC anywhere: fail loudly, with a message tailored to
	// who is looking at the error screen.
	const error = isDev
		? "PUBLIC_EXECUTION_MODE='signer' requires an RPC endpoint to broadcast " +
			'transactions from the local signer, but none is configured. Set ' +
			'PUBLIC_NODE_URL to a node RPC, or configure an rpcUrl on the chain in ' +
			'your deployments. (Wallet mode does not need this; the wallet provides ' +
			'the RPC.)'
		: 'This app is misconfigured and cannot send transactions right now. ' +
			'Please contact the site operator.';

	return {ok: false, error};
}
