import type {TargetStep} from './mode';

/**
 * Resolve the RPC url a local signer must use to BROADCAST transactions.
 *
 * A local signer signs locally and broadcasts raw (`eth_sendRawTransaction`),
 * so it needs a real node RPC of its own. It cannot simply ride the user's
 * wallet provider: under hosted sign-in the account may be an email or social
 * one with no wallet provider at all, and then there is nothing to ride. Any
 * real RPC satisfies this: an explicit `PUBLIC_NODE_URL`, or an RPC configured
 * on the chain itself (`rpcUrls.default.http`). Since rocketh no longer bakes
 * in viem's default public RPC, a chain rpcUrl present in the export is a
 * deliberate choice and is a valid source here.
 *
 * Required when the app targets `'SignedIn'` AND offers hosted mechanisms,
 * because that combination can authenticate an account with no wallet at all
 * (email, social). There is then nothing to fall back to, so a missing RPC is
 * fatal rather than merely awkward.
 *
 * NOT required for wallet-only sign-in. Every account there arrived through a
 * wallet, so the connection provider can carry the broadcast, exactly as it
 * does for an app that never signs in. Demanding an RPC in that case would make
 * a backend-free deployment refuse to start over a problem it does not have.
 */
export type SignerRpcResolution =
	{ok: true; rpcUrl: string | undefined} | {ok: false; error: string};

function firstNonEmpty(
	urls: readonly string[] | undefined,
): string | undefined {
	return urls?.find((url) => url?.trim())?.trim();
}

/**
 * @param config          Target step and whether sign-in is wallet-only.
 * @param explicitNodeURL `PUBLIC_NODE_URL` (empty/absent => not configured).
 * @param chainRpcUrls    The chain's `rpcUrls.default.http` from the export.
 * @param isDev           `import.meta.env.DEV` (developer-facing vs user-facing
 *   message). Passed in so this stays pure/testable.
 * @param options.awaitingPage `PUBLIC_NODE_URL` IS configured, in the same-host
 *   notation (`//:8545`, see core/env/same-host), and there is no page to
 *   resolve it against yet, which is SSR and prerender. The url is then not
 *   missing but not known, and this answers `ok` with no url rather than a
 *   fatal error.
 *
 *   WHY IT MATTERS: the context is built on the server too, and a fatal set
 *   there is rendered into the HTML. Without this every page of a signer app
 *   configured with `//:8545` (the dev and LAN `.env`s are) prerendered the
 *   "Failed to initialize" screen, and the browser showed it until the app
 *   took over. Nothing is lost by deferring: the browser always has a page, so
 *   it resolves the value for real and runs this check again, and a url that
 *   is genuinely missing there is still fatal there.
 */
export function resolveSignerRpc(
	config: {targetStep: TargetStep; walletOnly: boolean},
	explicitNodeURL: string | undefined,
	chainRpcUrls: readonly string[] | undefined,
	isDev: boolean,
	options?: {awaitingPage?: boolean},
): SignerRpcResolution {
	const rpcUrl = explicitNodeURL?.trim() || firstNonEmpty(chainRpcUrls);

	// Either there is no signer, or every account behind it has a wallet to
	// broadcast through. An absent url is fine; report whatever we have (may be
	// undefined) so the signer client can still prefer a real RPC when one
	// exists.
	if (config.targetStep !== 'SignedIn' || config.walletOnly) {
		return {ok: true, rpcUrl};
	}

	if (rpcUrl) {
		return {ok: true, rpcUrl};
	}

	// Configured, but only resolvable in a page: not known yet, not missing.
	if (options?.awaitingPage) {
		return {ok: true, rpcUrl: undefined};
	}

	// Signer mode with no RPC anywhere: fail loudly, with a message tailored to
	// who is looking at the error screen.
	const error = isDev
		? 'This app signs in (TARGET_STEP is SignedIn), which gives it a local ' +
			'signer, and broadcasting from that signer requires an RPC endpoint. ' +
			'None is configured. Set PUBLIC_NODE_URL to a node RPC, or configure an ' +
			'rpcUrl on the chain in your deployments. (An app that does not need a ' +
			"signer can set TARGET_STEP to 'WalletConnected' instead, and broadcast " +
			'through the wallet.)'
		: 'This app is misconfigured and cannot send transactions right now. ' +
			'Please contact the site operator.';

	return {ok: false, error};
}
