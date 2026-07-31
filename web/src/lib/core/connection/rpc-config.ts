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
	if (explicitNodeURL?.trim()) {
		return true;
	}
	return !!chainRpcUrls?.some((url) => url?.trim());
}
