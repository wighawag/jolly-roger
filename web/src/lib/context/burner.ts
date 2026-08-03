/**
 * Burner-wallet enablement resolution.
 *
 * The burner wallet is normally controlled by the `PUBLIC_USE_BURNER_WALLET`
 * env var, but a `burner` query param can override it at runtime (useful for
 * demos / testing without rebuilding). The param is registered as a global
 * query param (see `src/lib/index.ts`) so it survives navigation.
 *
 * Resolution:
 * - `?burner=false|0|off|no` -> force OFF
 * - `?burner` (present) / `?burner=true|1|on|yes` -> force ON
 * - no param -> fall back to the env-based default
 */

const FALSEY = new Set(['false', '0', 'off', 'no']);
const TRUTHY = new Set(['true', '1', 'on', 'yes', '']);

/**
 * Interpret the raw `burner` query-param value.
 *
 * Returns `true`/`false` when the param forces a decision, or `undefined` when
 * the param is absent (so the caller uses its env default). Note that a bare
 * `?burner` parses to `'true'` upstream (see `getParamsFromURL`), but `''` is
 * treated as truthy here too for safety.
 */
export function parseBurnerParam(raw: string | undefined): boolean | undefined {
	if (raw === undefined) return undefined;
	const value = raw.trim().toLowerCase();
	if (FALSEY.has(value)) return false;
	if (TRUTHY.has(value)) return true;
	// Unrecognised value: treat presence as "on" rather than silently ignoring.
	return true;
}

/**
 * Resolution of whether the burner wallet should be initialised.
 *
 * - `{use: true, nodeURL}` -> initialise the burner against `nodeURL`.
 * - `{use: false}` -> do not initialise (disabled by param or env).
 * - `{use: false, error}` -> the user explicitly asked for the burner
 *   (`?burner=true`) but the app cannot honour it (no node URL to point at).
 *   The caller MUST surface this error rather than silently continue.
 */
export type BurnerResolution =
	{use: true; nodeURL: string} | {use: false; error?: string};

/**
 * Decide whether/how to initialise the burner wallet.
 *
 * @param param    Resolved override from {@link parseBurnerParam} (or undefined).
 * @param envFlag  The `PUBLIC_USE_BURNER_WALLET` value: either an http(s) node
 *                 URL, or a truthy flag meaning "use the fallback node URL".
 * @param nodeURL  Fallback node URL (`PUBLIC_NODE_URL`), if any.
 */
export function resolveBurnerWallet(
	param: boolean | undefined,
	envFlag: string | undefined,
	nodeURL: string | undefined,
): BurnerResolution {
	// Explicit opt-out always wins.
	if (param === false) return {use: false};

	// The node URL the burner would point at: an http(s) env flag is itself the
	// URL, otherwise fall back to PUBLIC_NODE_URL.
	const target =
		envFlag && envFlag.startsWith('http') ? envFlag : nodeURL || undefined;

	if (param === true) {
		// Explicit opt-in: honour it, or fail loudly if we cannot.
		if (!target) {
			return {
				use: false,
				error:
					'`?burner=true` was requested but no node URL is configured for the ' +
					'burner wallet. Set PUBLIC_NODE_URL (or point ' +
					'PUBLIC_USE_BURNER_WALLET at an http(s) node URL).',
			};
		}
		return {use: true, nodeURL: target};
	}

	// No param: env decides. Enabled only when the env flag is set AND we have a
	// node URL to point at.
	if (envFlag && target) return {use: true, nodeURL: target};
	return {use: false};
}
