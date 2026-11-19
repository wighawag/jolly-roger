/**
 * Accounts the burner wallet is allowed to impersonate in local/dev setups.
 *
 * IMPERSONATION CANNOT SIGN, which is the fact this branch has to keep in mind.
 * An impersonated account can send transactions through the node, because the
 * node holds no key either, but it cannot SIGN anything. So it cannot sign the
 * message that derives the local signer, and an app that signs in
 * (`TARGET_STEP === 'SignedIn'`) never gets past `WalletConnected` with one
 * selected. The symptom is a connect flow that silently stalls, which is why the
 * e2e fixtures skip these accounts when picking one (see
 * `e2e/fixtures/test.ts`'s pickSignableAccount) rather than discovering it as a
 * timeout somewhere else.
 *
 * CONFIGURATION, not code: the list comes from `PUBLIC_IMPERSONATE_ADDRESSES`
 * (comma-separated), which `.env.localhost` populates for local development.
 * This module only parses it, so the app wiring (`context/index.ts`) and the e2e
 * fixtures read one value the same way and cannot drift.
 *
 * The e2e suite sets its own list (see scripts/run-e2e-tests.sh): files that
 * send transactions run in parallel workers, and two of them sending from the
 * same account race for the same nonce, so each needs an account of its own.
 */

/**
 * Parse the configured list.
 *
 * Pure and total. Entries are trimmed and blanks dropped, so a trailing comma or
 * a line broken for readability is not an error. Unset or empty yields an EMPTY
 * list rather than a built-in default: which accounts exist is a property of the
 * environment being run against, and inventing addresses for an environment that
 * did not ask for a burner wallet would be a guess.
 *
 * Entries that are not addresses (`0x` plus 40 hex digits) are dropped rather
 * than cast: the return type promises `0x${string}`, and a promise the parser
 * cannot keep is worse than a short list. `0x`, `0xzz` and a 39-digit address
 * are all typos that a prefix check would have waved through and that nothing
 * downstream can explain. What is NOT checked is whether the address means
 * anything on this chain, which is a question only the chain can answer.
 */
export function parseImpersonateAddresses(
	value: string | undefined,
	options?: {
		/**
		 * Called with anything discarded. The parser stays pure (it is shared with
		 * the e2e fixtures, which run in Node), so whoever has a place to complain
		 * to supplies one: a dropped entry otherwise shows up only as an account
		 * picker that is quietly one short.
		 */
		onDropped?: (entry: string) => void;
	},
): readonly `0x${string}`[] {
	const entries = (value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);

	const kept: `0x${string}`[] = [];
	for (const entry of entries) {
		if (/^0x[0-9a-fA-F]{40}$/.test(entry)) kept.push(entry as `0x${string}`);
		else options?.onDropped?.(entry);
	}
	return kept;
}
