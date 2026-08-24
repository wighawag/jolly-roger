import {
	test as base,
	expect,
	type Page,
	type BrowserContext,
} from '@playwright/test';
import {parseImpersonateAddresses} from '../../src/lib/dev-accounts';

/**
 * Extended test fixtures for E2E testing with wallet interactions.
 *
 * Each test starts with a clean browser state:
 * 1. playwright.config.ts sets storageState: {cookies: [], origins: []} for initial state
 * 2. This fixture creates a fresh context and clears localStorage on the target origin
 *    before any test code runs, ensuring complete isolation from auto-connect behavior
 */

/**
 * The addresses the burner wallet can impersonate.
 *
 * Read from the SAME environment variable the app was built against, parsed by
 * the same function (`src/lib/dev-accounts.ts`), so the accounts this suite
 * funds and picks are exactly the accounts the app offers. Hardcoding a list
 * here, or in the app, is how those two drift.
 *
 * `scripts/run-e2e-tests.sh` exports it for the whole run, which is why it is
 * required rather than defaulted: a silent fallback would mean funding accounts
 * the app does not offer, and failing several steps later on a picker that has
 * no such entry.
 */
const IMPERSONATE_ADDRESSES = parseImpersonateAddresses(
	(globalThis as any).process.env.PUBLIC_IMPERSONATE_ADDRESSES,
);
if (IMPERSONATE_ADDRESSES.length === 0) {
	throw new Error(
		'PUBLIC_IMPERSONATE_ADDRESSES is not set, so this suite does not know ' +
			'which accounts the app offers. Run the suite with `pnpm test:e2e` ' +
			'(scripts/run-e2e-tests.sh sets it), or export it yourself to match ' +
			'the build under test.',
	);
}

// Hardhat node URL. Use the IPv4 literal: the node binds to 127.0.0.1, and
// Node's fetch can resolve `localhost` to ::1 first, failing intermittently.
// Overridable so a run can avoid a port already in use on the machine; must
// agree with what scripts/run-e2e-tests.sh started the node on.
const RPC_PORT = (globalThis as any).process.env.E2E_RPC_PORT || '8545';
const HARDHAT_RPC_URL =
	(globalThis as any).process.env.E2E_RPC_URL || `http://127.0.0.1:${RPC_PORT}`;

/**
 * How many times one call to the node is worth sending: the original, plus a
 * single repeat for a connection that died in transit. Anything higher stops
 * being a transport allowance and starts being a way not to hear about a node
 * that is genuinely unwell.
 */
const RPC_ATTEMPTS = 2;
/** Long enough for a dropped socket to be replaced, short enough to not be a wait. */
const RPC_RETRY_DELAY_MS = 250;
/** How far a failure message follows `cause` before it stops. Cycles are legal. */
const MAX_CAUSE_DEPTH = 5;

// The app's base URL comes from playwright.config.ts (`use.baseURL`), so tests
// navigate with relative paths and nothing here needs to duplicate it.

/**
 * An error and everything it was caused by, one line each.
 *
 * Node's `fetch` throws a bare `TypeError: fetch failed` and puts the reason
 * that actually explains it - ECONNRESET, ECONNREFUSED, a socket timeout - on
 * `cause`. A message that prints only the top-level error therefore names the
 * symptom and hides the diagnosis, which is how a transport blip against the
 * node reads as an inscrutable four-word failure.
 */
function causeChain(error: unknown): string {
	const lines: string[] = [];
	let current: any = error;
	// Bounded: `cause` is a user-supplied field and nothing forbids a cycle.
	while (current && lines.length < MAX_CAUSE_DEPTH) {
		const parts = [
			`${current.name ?? typeof current}: ${current.message ?? String(current)}`,
		];
		for (const key of ['code', 'errno', 'syscall'] as const) {
			if (current[key] !== undefined) parts.push(`${key}=${current[key]}`);
		}
		lines.push(parts.join(' '));
		current = current.cause;
	}
	return lines.join('\n    caused by ');
}

/**
 * The node answered, and the answer was no.
 *
 * ITS OWN CLASS RATHER THAN A FLAG ON THE ERROR, because the alternative is to
 * smuggle the flag through `cause` - and `cause` already means something here:
 * `causeChain` walks it. A `{retryable: false}` sentinel parked there gets
 * walked into and printed as `object: [object Object]`, appending a line of
 * junk to the refusal message, which is the case with the most diagnostic
 * value in the whole function. So the marker goes somewhere the chain cannot
 * see it, and `cause` stays free for a real underlying error.
 */
class NodeRefusedCall extends Error {
	name = 'NodeRefusedCall';
}

/**
 * Fund an address using Hardhat's hardhat_setBalance RPC method.
 * This is useful for tests where we need to ensure the wallet has ETH.
 *
 * ONE RETRY, AND ONLY FOR THE TRANSPORT. Under parallel load several workers
 * fund at once and a connection to the node occasionally dies mid-request,
 * which surfaced as `TypeError: fetch failed` in a test that had already
 * connected its wallet successfully - a socket problem wearing the costume of
 * an app problem. This is not a test retry (those hide signal): it is one call
 * to a node that dropped one connection, and it is safe only because
 * `hardhat_setBalance` sets an ABSOLUTE balance, so sending it twice lands on
 * the same state as sending it once. Do not copy this loop onto anything that
 * accumulates, like a transfer.
 *
 * WHAT COUNTS AS AN ANSWER, and so is never repeated:
 *
 * - a JSON-RPC error in the body: the node considered the call and refused it
 * - any 4xx: the request itself is wrong, and it will be just as wrong twice
 * - a body that is not JSON: something that is not the node replied (a proxy,
 *   or the wrong port), and it will reply the same way again
 *
 * A 5xx is NOT an answer in that sense - the node can be transiently unable to
 * serve while it is being hammered by eight workers - so it is retried along
 * with the transport failures.
 */
export async function fundAddressViaHardhat(
	address: string,
	amountInEth = '100',
): Promise<void> {
	// Convert ETH to wei (hex)
	const weiAmount = BigInt(parseFloat(amountInEth) * 1e18);
	const hexAmount = '0x' + weiAmount.toString(16);

	for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(HARDHAT_RPC_URL, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'hardhat_setBalance',
					params: [address, hexAmount],
					id: 1,
				}),
			});

			if (!response.ok) {
				const description = `hardhat_setBalance returned HTTP ${response.status} ${response.statusText}`;
				if (response.status < 500) throw new NodeRefusedCall(description);
				throw new Error(description);
			}

			// The node answers a rejected call with HTTP 200 and an `error` member,
			// so a body nobody reads is a funding failure nobody notices - until a
			// later assertion fails for want of gas and takes the blame.
			//
			// Read as TEXT first: `response.json()` gives no way to show what it
			// choked on, and swallowing the parse failure would re-open exactly the
			// hole this paragraph exists to close, since an unreadable body would
			// then pass for success.
			const raw = await response.text();
			let body: {error?: {message?: string; code?: number}};
			try {
				body = JSON.parse(raw);
			} catch {
				throw new NodeRefusedCall(
					`hardhat_setBalance got a reply that is not JSON: ${raw.slice(0, 200)}`,
				);
			}
			if (body?.error) {
				throw new NodeRefusedCall(
					`hardhat_setBalance refused for ${address}: ` +
						`${body.error.message ?? 'no message'} (code ${body.error.code ?? 'none'})`,
				);
			}
			return;
		} catch (error) {
			if (error instanceof NodeRefusedCall || attempt === RPC_ATTEMPTS) {
				throw new Error(
					`could not fund ${address} via ${HARDHAT_RPC_URL} ` +
						`(attempt ${attempt} of ${RPC_ATTEMPTS}):\n    ${causeChain(error)}`,
					{cause: error},
				);
			}
			await new Promise((resolve) => setTimeout(resolve, RPC_RETRY_DELAY_MS));
		}
	}
}

export interface WalletOptions {
	/**
	 * Which burner account (index into PUBLIC_IMPERSONATE_ADDRESSES) the connect
	 * flow picks in the account-picker dialog.
	 *
	 * All e2e tests share ONE chain and the GreetingsRegistry keeps ONE message
	 * per account, so two test files writing from the same account clobber each
	 * other's message mid-test (files run in parallel workers). Give a file that
	 * writes messages its own account with `test.use({walletAccountIndex: 1})`
	 * so its writes cannot race the demo suite's (which uses the default 0).
	 */
	walletAccountIndex: number;
}

export interface WalletFixtures {
	/**
	 * Page with clean localStorage - starts with no wallet connection state.
	 * This overrides the default page fixture to ensure test isolation.
	 */
	page: Page;

	/**
	 * Page with wallet connected via Dev Mode (burner wallet).
	 * Automatically handles the connection flow.
	 */
	connectedPage: Page;

	/**
	 * Connects the wallet using Dev Mode on the current page.
	 * Can be used when you need more control over when connection happens.
	 */
	connectWallet: (page: Page) => Promise<void>;

	/**
	 * Waits for a transaction to be confirmed.
	 */
	waitForTransaction: (page: Page) => Promise<void>;

	/**
	 * Submit a greeting and wait until it is visible and settled on-chain.
	 * Preferred over open-coding fill/click/waitForTransaction: it fails at the
	 * step that actually broke instead of at a later assertion.
	 */
	submitGreeting: (page: Page, message: string) => Promise<void>;

	/**
	 * Ensures the test wallet addresses have ETH on the Hardhat node.
	 * Call this before tests that need funded wallets.
	 */
	fundWallets: () => Promise<void>;
}

// The app's authoritative connection signal (see navbar.svelte). Reading the
// navbar balance text instead - as this fixture used to - gives false negatives:
// the balance span renders empty while the balance is still loading, so a
// connected app reads as disconnected.
const WALLET_STATUS = '[data-testid="wallet-status"]';

async function isWalletConnected(page: Page): Promise<boolean> {
	const attr = await page
		.locator(WALLET_STATUS)
		.getAttribute('data-connected')
		.catch(() => null);
	return attr === 'true';
}

/** Assert the wallet is connected, failing with a clear message if it is not. */
async function expectWalletConnected(page: Page, timeout = 30_000) {
	await expect(
		page.locator(WALLET_STATUS),
		'wallet should be connected (navbar data-connected)',
	).toHaveAttribute('data-connected', 'true', {timeout});
}

/**
 * Connect wallet via the burner wallet.
 *
 * The connect flow is a sequence of modals whose order varies with config and
 * auto-connect state (the account picker can appear immediately on page load
 * when a multi-account wallet auto-reconnects, without any connect button):
 *
 * - connect entry: "Dev Mode" (SignedIn + dev) or "Connect <wallet>" button
 * - account picker: "N accounts available, choose one" (multi-account wallet)
 * - sign-in confirm: "Confirm sign in" (SignedIn config)
 *
 * Rather than assuming an order, poll for whichever dialog is currently shown
 * and act on it, until no connect-flow dialog remains (or timeout).
 */
async function connectWalletDevMode(
	page: Page,
	accountIndex = 0,
): Promise<void> {
	const deadline = Date.now() + 45_000;

	while (Date.now() < deadline) {
		const dialog = page.locator('[role="dialog"]');
		const dialogVisible = await dialog
			.first()
			.isVisible({timeout: 1000})
			.catch(() => false);

		if (!dialogVisible) {
			// No dialog on screen means EITHER the connection completed, OR the next
			// modal has simply not opened yet (transitions lag under load).
			//
			// Concluding "done" from the absence of a dialog is what made this suite
			// flaky: the helper returned before the account picker had rendered, the
			// test then clicked send, the picker opened with nobody left to answer
			// it, and so no transaction was ever sent - surfacing much later as a
			// "message never appeared" failure in whichever test drew the short
			// straw. Only stop once the app itself reports a connection.
			if (await isWalletConnected(page)) break;
			await page.waitForTimeout(250);
			continue;
		}

		// The dialog may close between the isVisible check above and this read;
		// without an explicit timeout, textContent would wait forever (Playwright's
		// default action timeout is unlimited) and hang the fixture until the test
		// times out. Bound it and treat a vanished dialog as "loop again".
		const text = await dialog
			.first()
			.textContent({timeout: 2000})
			.catch(() => null);
		if (text === null) continue;

		if (/wallets available, choose one/i.test(text)) {
			// Wallet list (multiple injected wallets, shown inline under wallet-only
			// auth or via the picker): choose the burner wallet.
			await dialog
				.locator('.overflow-y-auto > button', {hasText: 'Burner Wallet'})
				.first()
				.click();
		} else if (/accounts available, choose one/i.test(text)) {
			// Account picker: pick the configured account in the scrollable list.
			// Use the DIRECT children of the list: each account row button nests a
			// "Copy address" button inside it, so a descendant selector ('div button')
			// would interleave copy buttons into the index space and .nth(1) would hit
			// account 0's copy button instead of account 1.
			await dialog
				.locator('.overflow-y-auto > button')
				.nth(accountIndex)
				.click();
		} else if (/confirm sign in/i.test(text)) {
			// Under a sign-in target, the confirm dialog may be the COMBINED
			// choose+sign-in modal (multi-account wallet): select the configured
			// account row first (same direct-child locator as the plain picker),
			// then sign. With no rows (single-account confirm), just sign.
			const rows = dialog.locator('.overflow-y-auto > button');
			// WAIT BEFORE COUNTING. This branch is reached on the dialog's TEXT, and
			// the heading renders before the list body does, so counting immediately
			// can see zero rows in a dialog that is about to have several. Then the
			// account is never selected and sign-in proceeds as the wrong one, which
			// surfaces far away as a transaction from an account with no funds.
			//
			// Bounded and swallowed, because ZERO IS ALSO A REAL ANSWER here: the
			// single-account confirm dialog has no rows at all and just signs in.
			await rows
				.first()
				.waitFor({state: 'attached', timeout: 2000})
				.catch(() => {});
			if ((await rows.count()) > accountIndex) {
				await rows.nth(accountIndex).click();
			}
			await page.getByRole('button', {name: /^sign in$/i}).click();
		} else if (/insufficient funds|funds available/i.test(text)) {
			// Funding is handled by handleInsufficientFundsModal below.
			break;
		} else {
			// Connect entry: dev-mode button (SignedIn + dev) or the wallet connect
			// button (accessible name includes the icon alt text, so match loosely).
			const entry = page
				.getByRole('button', {name: /dev mode/i})
				.or(page.getByRole('button', {name: /connect .*wallet/i}))
				.first();
			const entryVisible = await entry
				.isVisible({timeout: 1000})
				.catch(() => false);
			if (entryVisible) {
				await entry.click();
			} else {
				// Unknown dialog (e.g. a transient step): wait for it to change.
				await page.waitForTimeout(500);
			}
		}
		await page.waitForTimeout(250);
	}

	// Handle Insufficient Funds modal - click "Get ETH" to use the faucet API
	await handleInsufficientFundsModal(page);

	// Fail here, loudly and at the real cause, rather than handing back a page
	// that is not connected and letting a later assertion take the blame.
	await expectWalletConnected(page);
}

/**
 * Handle the Insufficient Funds modal by clicking "Get ETH" and then "Continue Transaction".
 * This modal appears when the wallet is connected but doesn't have enough ETH.
 */
async function handleInsufficientFundsModal(page: Page): Promise<void> {
	const getEthButton = page.getByRole('button', {name: /get eth/i});

	// The modal is genuinely optional, so its ABSENCE is not an error - but once
	// it is on screen the rest of the flow must work. Wrapping the whole sequence
	// in `catch {}` (as this used to) also swallowed a broken funding flow, so a
	// test that never got its ETH failed later somewhere unrelated.
	const appeared = await getEthButton
		.waitFor({state: 'attached', timeout: 5000})
		.then(() => true)
		.catch(() => false);

	if (!appeared) return;

	// Wait for it to be enabled (not loading)
	await expect(getEthButton).toBeEnabled({timeout: 30000});

	// Click "Get ETH" - this will call the faucet API
	await getEthButton.click();

	// Wait for "Continue Transaction" button to appear and be enabled
	const continueButton = page.getByRole('button', {
		name: /continue transaction/i,
	});
	await continueButton.waitFor({state: 'visible', timeout: 30000});
	await expect(continueButton).toBeEnabled({timeout: 10000});

	// Click "Continue Transaction" to proceed with the original transaction
	await continueButton.click();

	// Wait for the modal to close.
	// NOTE: waitForFunction's signature is (fn, arg, options); options must be
	// the THIRD argument or the timeout silently never applies (waits forever).
	await page.waitForFunction(
		() => {
			const modal = document.querySelector('[role="dialog"]');
			return !modal || !modal.textContent?.includes('Funds');
		},
		undefined,
		{timeout: 10000},
	);
}

const MESSAGE_ROW = '[data-testid="message-row"]';
const MESSAGE_PENDING = '[data-testid="message-pending"]';
// The app's own count of operations that have not reached a final state. Not
// demo-specific, so a suite for any feature can wait on it.
const PENDING_OPERATIONS = '[data-testid="pending-operations"]';

/**
 * Wait for every in-flight write to settle.
 *
 * The previous implementation polled for `[class*="animate-spin"]` and wrapped
 * BOTH waits in `catch {}`, which made it incapable of failing: it returned
 * after at most ~40s whether or not a transaction had happened, so a write that
 * never left the browser surfaced as an unrelated assertion timeout later on.
 * It also matched the navbar's own loading spinner, so it could settle while a
 * write was still open.
 *
 * `message-pending` is the app's real per-message in-flight flag, and a timeout
 * here now fails the test at the actual cause.
 */
async function waitForTransactionComplete(page: Page): Promise<void> {
	await expect(
		page.locator(PENDING_OPERATIONS),
		'all in-flight operations should have settled',
	).toHaveCount(0, {timeout: 60_000});
}

/**
 * Submit a greeting and wait until it is on-chain and settled.
 *
 * Tests previously open-coded fill -> click -> waitForTransaction and then
 * asserted the text separately. Each step could silently no-op, so the failure
 * always landed on the final assertion regardless of which step actually broke.
 * Doing it in one place means the error names the step that failed.
 */
async function submitGreeting(page: Page, message: string): Promise<void> {
	const input = page.getByPlaceholder('Enter your greeting...');
	await expect(input, 'greeting input should be ready').toBeEnabled({
		timeout: 30_000,
	});
	await input.fill(message);

	const sendButton = page.getByRole('button', {name: /send/i});
	await expect(
		sendButton,
		'send should be enabled once input has text',
	).toBeEnabled({timeout: 30_000});
	await sendButton.click();

	// A write can surface a funding prompt before it reaches the chain.
	await handleInsufficientFundsModal(page);

	// The row appears optimistically with a pending spinner, then settles.
	const row = page.locator(MESSAGE_ROW).filter({hasText: message});
	await expect(
		row,
		`greeting "${message}" should appear in the list`,
	).toBeVisible({timeout: 60_000});
	await expect(
		row.locator(MESSAGE_PENDING),
		`greeting "${message}" should settle on-chain`,
	).toHaveCount(0, {timeout: 60_000});
}

export const test = base.extend<WalletFixtures & WalletOptions>({
	// Option fixture: which burner account the connect flow selects.
	// Override per file/describe with `test.use({walletAccountIndex: 1})`.
	walletAccountIndex: [0, {option: true}],
	/**
	 * Override the default page fixture to ensure each test starts with clean storage.
	 *
	 * This creates a fresh browser context with empty storage state for each test,
	 * then navigates to the app to clear any storage on the correct origin,
	 * ensuring no previous wallet connection state persists between tests.
	 */
	page: async ({browser}, use) => {
		// A brand-new context is already storage-isolated, and the explicit
		// storageState states that: no cookies, no origin storage. So there is
		// nothing to clear before the test runs.
		//
		// This used to prime the context by navigating to the app origin with
		// `waitUntil: 'commit'`, clearing storage, then navigating to about:blank.
		// Committing and immediately navigating away races the in-flight load and
		// intermittently aborted it outright (`net::ERR_ABORTED`), failing tests
		// that had not run a line of their own code yet. The dance bought no
		// isolation the fresh context did not already provide.
		//
		// Note storage must NOT be cleared on every navigation (e.g. via
		// addInitScript): the app persists the wallet connection there, and tests
		// that navigate between pages rely on it surviving.
		const context = await browser.newContext({
			storageState: {cookies: [], origins: []},
		});

		const page = await context.newPage();

		await use(page);
		await context.close();
	},

	/**
	 * Fund wallet addresses via Hardhat RPC before tests.
	 */
	fundWallets: async ({}, use) => {
		const fundAll = async () => {
			for (const address of IMPERSONATE_ADDRESSES) {
				await fundAddressViaHardhat(address, '100');
			}
		};
		await use(fundAll);
	},

	/**
	 * Provides a page that's already connected to a wallet.
	 * Usage:
	 *   test('my test', async ({ connectedPage }) => { ... })
	 */
	connectedPage: async ({page, fundWallets, walletAccountIndex}, use) => {
		// Out of range fails here, naming the cause, instead of several steps later
		// on an account picker that has no such entry. The mapping of index to test
		// file is in scripts/run-e2e-tests.sh, next to the list itself.
		if (walletAccountIndex >= IMPERSONATE_ADDRESSES.length) {
			throw new Error(
				`walletAccountIndex ${walletAccountIndex} is out of range: ` +
					`PUBLIC_IMPERSONATE_ADDRESSES has ${IMPERSONATE_ADDRESSES.length} ` +
					`account(s). Add one to web/e2e/impersonate-addresses.json if this ` +
					`file needs an account of its own (files that send transactions do, ` +
					`or they race each other for a nonce).`,
			);
		}

		// Fund the wallet addresses BEFORE navigating to the page
		// This ensures the wallet has ETH when the app auto-connects
		await fundWallets();

		// Navigate to demo page
		await page.goto('/demo');

		// Wait for app to initialize
		const input = page.getByPlaceholder('Enter your greeting...');
		await expect(input).toBeVisible({timeout: 30000});

		// Ask the app whether it is connected, rather than inferring it from the
		// navbar balance: the balance span is empty while loading and hidden below
		// the `sm` breakpoint, so the old check reported "disconnected" for an
		// already-connected app and re-ran the connect flow on top of it - which
		// re-opened the account picker in the middle of the test.
		if (!(await isWalletConnected(page))) {
			// Connect through the navbar's dedicated Connect affordance.
			//
			// This used to fill the input and `click({force: true})` the Send button.
			// Two problems: `force` skips actionability, so while the app was still
			// initialising and Send was disabled the click was a silent no-op - no
			// dialog opened, the connect flow never started, and the fixture handed
			// back an unconnected page. It also wrote a junk "fixture-connection-test"
			// greeting to the chain on every single test purely as a side effect of
			// connecting, costing a transaction and polluting the message list.
			const connectButton = page
				.getByRole('button', {name: /^connect$/i})
				.first();
			await expect(
				connectButton,
				'navbar Connect should become actionable once the app has initialised',
			).toBeEnabled({timeout: 60_000});
			await connectButton.click();

			// Connect using Dev Mode (handles both connection modal and funding if needed)
			await connectWalletDevMode(page, walletAccountIndex);
		}

		// Never hand a test a page that is not actually connected.
		await expectWalletConnected(page);

		// The input must be interactive before the test starts driving it.
		await expect(input).toBeEnabled({timeout: 30_000});

		await use(page);
	},

	/**
	 * Provides a function to connect wallet on demand.
	 */
	connectWallet: async ({fundWallets, walletAccountIndex}, use) => {
		// Ensure wallets are funded before connecting
		await fundWallets();
		await use((page: Page) => connectWalletDevMode(page, walletAccountIndex));
	},

	/**
	 * Provides a function to wait for transactions.
	 */
	waitForTransaction: async ({}, use) => {
		await use(waitForTransactionComplete);
	},

	/**
	 * Provides the atomic submit-and-settle helper.
	 */
	submitGreeting: async ({}, use) => {
		await use(submitGreeting);
	},
});

export {expect};

// Re-export describe for convenience
export const describe = test.describe;
