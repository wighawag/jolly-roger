/**
 * Accounts the burner wallet is allowed to impersonate in local/dev setups.
 *
 * Impersonation lets a local chain act as a well-known address (vitalik.eth and
 * friends) without holding its key, which is useful for eyeballing an app as
 * somebody interesting. The catch is exactly that missing key: an impersonated
 * account can send transactions through the node, but it cannot SIGN anything.
 * So it cannot sign the message that derives the local signer, and an app that
 * signs in (`TARGET_STEP === 'SignedIn'`) can never get past `WalletConnected`
 * with one selected. The symptom is a connect flow that silently stalls.
 *
 * Hence the env var, and hence it being EMPTY on this branch: this app signs in,
 * so offering accounts that cannot complete sign-in would only ever be a trap.
 * A branch that stops at `WalletConnected` has no such problem and can list
 * them freely.
 *
 * Parsing lives here, reading the env does not, so that the e2e fixtures (plain
 * Node, no SvelteKit) can share this exact function instead of reimplementing
 * the format and drifting from it.
 */

/**
 * Parse a comma-separated address list.
 *
 * Silently drops anything that is not a 20-byte hex address rather than
 * throwing: this is dev-only convenience configuration, and a stray comma or a
 * half-pasted address should not take down app construction (which also has to
 * survive prerendering, where nothing can be shown to anyone). Empty, absent
 * and all-invalid all mean "no impersonation".
 */
export function parseImpersonateAddresses(
	raw: string | undefined,
): readonly `0x${string}`[] {
	return (raw ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry): entry is `0x${string}` =>
			/^0x[0-9a-fA-F]{40}$/.test(entry),
		);
}
