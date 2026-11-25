import {readFileSync} from 'node:fs';
import {ACCOUNT_COUNT} from '@etherkit/burner-wallet';
import {parseImpersonateAddresses} from '../../src/lib/dev-accounts';

/**
 * WHICH ACCOUNTS THE E2E SUITES SEND FROM: the burner wallet's own.
 *
 * The burner generates a fresh mnemonic per browser context (each test starts
 * with empty storage) and derives `ACCOUNT_COUNT` accounts from it, keys and
 * all. A suite picks one by index, `test.use({walletAccountIndex: N})`, and the
 * fixture funds it once it is connected, since its address does not exist
 * before that.
 *
 * NOT IMPERSONATED ADDRESSES. `PUBLIC_IMPERSONATE_ADDRESSES` is the app's env:
 * a dev convenience (`.env.localhost`) that lists addresses the burner may act
 * as on a hardhat node, with no key. The e2e build runs with it EMPTY
 * (scripts/run-e2e-tests.sh pins it, playwright.config.ts too), so the picker
 * holds only generated accounts and the suite depends on nothing the app is
 * configured with. An address that holds no key cannot sign anything, and a
 * famous one (vitalik.eth) drags a mainnet ENS lookup into every run.
 *
 * THE POOL IS TEST-ONLY CONFIGURATION, in `e2e/accounts.json`: how many
 * indices the suites may claim, one per file that sends, which
 * `test/e2e-account-claims.test.ts` checks the claims against.
 */
const CONFIG = JSON.parse(
	readFileSync(new URL('../accounts.json', import.meta.url), 'utf8'),
) as {poolSize?: unknown};

const poolSize = CONFIG.poolSize;
if (
	typeof poolSize !== 'number' ||
	!Number.isInteger(poolSize) ||
	poolSize < 1 ||
	poolSize > ACCOUNT_COUNT
) {
	throw new Error(
		`e2e/accounts.json: poolSize must be an integer from 1 to ${ACCOUNT_COUNT} ` +
			`(the accounts the burner derives), got ${JSON.stringify(poolSize)}.`,
	);
}

/** How many burner accounts the suites may claim, by index from 0. */
export const E2E_ACCOUNT_POOL_SIZE: number = poolSize;

/**
 * Fail at load, naming the cause, when the run is configured to impersonate.
 *
 * Impersonated addresses are listed BEFORE the generated ones in the burner's
 * picker, so a non-empty list would silently shift every `walletAccountIndex`
 * onto an address the suite did not fund (and, where the app signs in, one
 * that cannot sign).
 */
export function assertImpersonationOff(value: string | undefined): void {
	const configured = parseImpersonateAddresses(value);
	if (configured.length > 0) {
		throw new Error(
			`PUBLIC_IMPERSONATE_ADDRESSES is set (${configured.join(', ')}), but the ` +
				`e2e suites send from the burner's own generated accounts and expect ` +
				`it EMPTY. Run with \`pnpm test:e2e\` (scripts/run-e2e-tests.sh pins it ` +
				`empty for the build) or unset it.`,
		);
	}
}
