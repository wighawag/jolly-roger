/**
 * How the app authenticates, and therefore whether it has a local signer.
 *
 * Two knobs, and only one of them is env:
 *
 * - `TARGET_STEP` is CONFIG, set in code below. It decides how far the
 *   connection goes and so whether a local signer exists at all.
 * - `PUBLIC_WALLET_HOST` decides only whether HOSTED mechanisms (email, social)
 *   are on offer. It does not decide the target step.
 *
 * Splitting them is deliberate. Signing in derives a local signer from a
 * signature, which costs the user a wallet prompt; an app that will never use a
 * signer should not pay it. That is a decision about what the app IS, not about
 * which services it happens to be pointed at, so it belongs in code where it is
 * read alongside the app's other structural choices.
 */

export type TargetStep = 'WalletConnected' | 'SignedIn';

/**
 * How far this app's connection goes.
 *
 * `'WalletConnected'`: stop at a connected wallet. No signature, no signer, no
 * prompt the user did not ask for. Correct for an app that only ever sends from
 * the user's own account, which is what this template is.
 *
 * `'SignedIn'`: the user signs a message once, which derives a local signer the
 * app could send from without prompting, and hosted mechanisms (email, social)
 * become offerable when `PUBLIC_WALLET_HOST` is set.
 *
 * FLIPPING THIS IS NOT THE WHOLE JOB. This branch has no code that SENDS from
 * the derived signer: `createExecutor` sends from the authenticated account and
 * nothing else. So `'SignedIn'` here buys the sign-in mechanisms and a signer
 * nobody spends from, and an account authenticated by email has no wallet and
 * therefore cannot send at all. The executor, balances and funding UI that make
 * a signer useful live on the signer variant; take them from there rather than
 * rebuilding them.
 */
export const TARGET_STEP: TargetStep = 'WalletConnected';

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
	 * are popup flows served BY that host and cannot work without one.
	 */
	walletOnly: boolean;
};

/**
 * Resolve the connection configuration.
 *
 * Total: there is no illegal combination left to reject. This used to guard one
 * (signer execution without a signer), which disappeared along with the
 * execution-mode axis: there is now a single executor, it sends from the
 * authenticated account, and no configuration can ask it to do otherwise.
 */
export function resolveConnectionConfig(
	targetStep: TargetStep,
	walletHost: string | undefined,
): ConnectionConfig {
	const host = walletHost?.trim() || undefined;
	return {targetStep, walletHost: host, walletOnly: !host};
}
