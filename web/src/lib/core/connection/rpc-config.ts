/**
 * Whether the app itself provides an RPC endpoint to reach the chain, i.e. an
 * explicit `PUBLIC_NODE_URL` or an rpcUrl configured on the chain
 * (`rpcUrls.default.http`).
 *
 * When false, the app has no RPC of its own: it can only read/write the chain
 * through the user's connected wallet provider. This is a valid, supported
 * state (see establishRemoteConnection / prioritizeWalletProvider), but it
 * means the app should not attempt to fetch chain data while disconnected, and
 * the UI should explain "connect your wallet to load data" rather than report a
 * failing RPC. rocketh no longer bakes viem's default public RPC into the
 * export, so an empty rpcUrls list genuinely means "no app RPC".
 */
export function hasConfiguredRpc(
	explicitNodeURL: string | undefined,
	chainRpcUrls: readonly string[] | undefined,
): boolean {
	return !!resolveAppRpcUrl(explicitNodeURL, chainRpcUrls);
}

/**
 * WHICH RPC that is, when there is one.
 *
 * The same question as {@link hasConfiguredRpc}, answered with the url rather
 * than a yes, for the callers that need to talk to it directly rather than
 * merely know it exists (the nonce-cache check, which compares the wallet's
 * idea of the nonce against a trusted node's).
 *
 * `PUBLIC_NODE_URL` wins over a chain rpcUrl: an explicit setting is a
 * deliberate override of whatever the deployment happens to carry.
 */
export function resolveAppRpcUrl(
	explicitNodeURL: string | undefined,
	chainRpcUrls: readonly string[] | undefined,
): string | undefined {
	const explicit = explicitNodeURL?.trim();
	if (explicit) {
		return explicit;
	}
	return chainRpcUrls?.map((url) => url?.trim()).find((url) => !!url);
}
