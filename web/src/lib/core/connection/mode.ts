/**
 * Connection + execution mode resolution.
 *
 * Two independent, env-derived knobs govern how the app authenticates and how
 * it sends transactions:
 *
 * - `targetStep`: derived from `PUBLIC_WALLET_HOST`.
 *   - set   -> `'SignedIn'`: hosted sign-in (email/social) + a local signer.
 *   - empty -> `'WalletConnected'`: wallet-only authentication.
 *
 * - `executionMode` (`PUBLIC_EXECUTION_MODE`): how transactions are sent.
 *   - `'wallet'` (default): send from the connected wallet account.
 *   - `'signer'`: send from the local signer (works for every account,
 *     including wallet-authenticated ones).
 *
 * The two are independent except for one constraint: `'signer'` execution needs
 * a local signer, which only exists under `'SignedIn'`. That single illegal
 * combination is rejected here (fail fast) rather than blowing up later.
 *
 * The valid matrix:
 *
 *   targetStep        executionMode  result
 *   WalletConnected   wallet         tx via wallet (current default)
 *   WalletConnected   signer         INVALID (no signer without SignedIn)
 *   SignedIn          wallet         wallet accounts send; email/social accounts
 *                                    cannot send directly (runtime typed error)
 *   SignedIn          signer         everyone sends via the local signer
 */

export type TargetStep = 'WalletConnected' | 'SignedIn';
export type ExecutionMode = 'wallet' | 'signer';

export type ConnectionMode = {
	targetStep: TargetStep;
	/** Hosted sign-in service URL (only defined when targetStep is 'SignedIn'). */
	walletHost?: string;
	executionMode: ExecutionMode;
};

export type ConnectionModeResolution =
	{ok: true; mode: ConnectionMode} | {ok: false; error: string};

/**
 * Interpret the raw `PUBLIC_EXECUTION_MODE` value.
 *
 * Empty/absent defaults to 'wallet'. Unrecognised values return undefined so
 * the caller can fail fast (a typo like 'singer' silently becoming 'wallet'
 * would be a confusing misconfiguration).
 */
export function parseExecutionMode(
	raw: string | undefined,
): ExecutionMode | undefined {
	const value = (raw ?? '').trim().toLowerCase();
	if (value === '' || value === 'wallet') return 'wallet';
	if (value === 'signer') return 'signer';
	return undefined;
}

/**
 * Resolve the connection + execution mode from env values.
 *
 * @param walletHost   `PUBLIC_WALLET_HOST` (presence => SignedIn).
 * @param executionRaw `PUBLIC_EXECUTION_MODE` (raw string).
 */
export function resolveConnectionMode(
	walletHost: string | undefined,
	executionRaw: string | undefined,
): ConnectionModeResolution {
	const host = walletHost?.trim() || undefined;
	const targetStep: TargetStep = host ? 'SignedIn' : 'WalletConnected';
	const executionMode = parseExecutionMode(executionRaw);

	if (executionMode === undefined) {
		return {
			ok: false,
			error:
				`Unrecognised PUBLIC_EXECUTION_MODE value: '${executionRaw}'. ` +
				"Use 'wallet' (send from the connected wallet account) or " +
				"'signer' (send from the local signer), or leave it empty for " +
				"the default ('wallet').",
		};
	}

	if (executionMode === 'signer' && targetStep !== 'SignedIn') {
		return {
			ok: false,
			error:
				"PUBLIC_EXECUTION_MODE='signer' requires hosted sign-in: set " +
				'PUBLIC_WALLET_HOST so a local signer is available (otherwise ' +
				"there is no signer to send transactions from). Use 'wallet' " +
				'execution mode for wallet-only setups.',
		};
	}

	return {
		ok: true,
		mode: {targetStep, walletHost: host, executionMode},
	};
}
