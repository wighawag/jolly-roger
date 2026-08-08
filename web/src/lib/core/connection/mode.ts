/**
 * How the app authenticates, and therefore whether it has a local signer.
 *
 * Two knobs, and only one of them is env:
 *
 * - `TARGET_STEP` is CONFIG, set in code below. It decides how far the
 *   connection goes and so whether a local signer exists at all.
 * - `PUBLIC_WALLET_HOST` decides only whether HOSTED mechanisms (email, social)
 *   are on offer. It no longer decides the target step.
 *
 * Splitting them is deliberate. Signing in derives a local signer from a
 * signature, which costs the user a wallet prompt; an app that will never use a
 * signer should not pay it. That is a decision about what the app IS, not about
 * which services it happens to be pointed at, so it belongs in code where it is
 * read alongside the app's other structural choices, and where a descendant
 * changes it in one obvious place.
 */

export type TargetStep = 'WalletConnected' | 'SignedIn';

/**
 * How far this app's connection goes.
 *
 * `'SignedIn'`: the user signs a message once, which derives a local signer the
 * app can send from without prompting. Everything that wants to act on the
 * user's behalf (game moves, anything frequent) needs this.
 *
 * `'WalletConnected'`: stop at a connected wallet. No signature, no signer, no
 * prompt the user did not ask for. Correct for an app that only ever sends from
 * the user's own account.
 *
 * THE ONE LINE a descendant changes to gain or drop the signer. Everything else
 * keys on `targetStep`, never on `PUBLIC_WALLET_HOST`, so this is the whole
 * switch.
 */
export const TARGET_STEP: TargetStep = 'SignedIn';

export type ConnectionConfig = {
	targetStep: TargetStep;
	/**
	 * Hosted sign-in service URL. Undefined means no hosted mechanisms, which is
	 * a supported configuration rather than an error: see `walletOnly`.
	 */
	walletHost?: string;
	/**
	 * Whether only built-in (injected / EIP-6963) wallets may authenticate.
	 *
	 * True whenever there is no `walletHost`, because email and social sign-in
	 * are popup flows served BY that host and cannot work without one. Note this
	 * does not prevent signing in: the signer is derived locally from a wallet
	 * signature over an origin-scoped message, with no service involved, so
	 * `SignedIn` + `walletOnly` is a complete, backend-free configuration.
	 */
	walletOnly: boolean;
};

/**
 * Resolve the connection configuration.
 *
 * Total: there is no illegal combination left to reject. `SignedIn` without a
 * host means wallet-only sign-in; `WalletConnected` with a host simply never
 * uses it. The one invalid combination this used to guard (signer execution
 * without a signer) disappeared with `PUBLIC_EXECUTION_MODE`: call sites now
 * name the executor they want, and one that has no signer behind it is never
 * `ready` rather than being a misconfiguration.
 */
export function resolveConnectionConfig(
	targetStep: TargetStep,
	walletHost: string | undefined,
): ConnectionConfig {
	const host = walletHost?.trim() || undefined;
	return {targetStep, walletHost: host, walletOnly: !host};
}
