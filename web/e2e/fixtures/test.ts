import {
	test as base,
	expect,
	type Page,
	type BrowserContext,
} from '@playwright/test';
import {IMPERSONATE_ADDRESSES} from '../../src/lib/dev-accounts';

/**
 * Extended test fixtures for E2E testing with wallet interactions.
 *
 * Each test starts with a clean browser state:
 * 1. playwright.config.ts sets storageState: {cookies: [], origins: []} for initial state
 * 2. This fixture creates a fresh context and clears localStorage on the target origin
 *    before any test code runs, ensuring complete isolation from auto-connect behavior
 */

// The addresses the burner wallet can impersonate come from the single source
// of truth shared with the app wiring: src/lib/dev-accounts.ts.

// Hardhat node URL. Use the IPv4 literal: the node binds to 127.0.0.1, and
// Node's fetch can resolve `localhost` to ::1 first, failing intermittently.
// Overridable so a run can avoid a port already in use on the machine; must
// agree with what scripts/run-e2e-tests.sh started the node on.
const RPC_PORT = (globalThis as any).process.env.E2E_RPC_PORT || '8545';
const HARDHAT_RPC_URL =
	(globalThis as any).process.env.E2E_RPC_URL || `http://127.0.0.1:${RPC_PORT}`;

// Base URL for the web app (matches playwright.config.ts)
const BASE_URL = `http://localhost:${(globalThis as any).process.env.E2E_PORT || 4173}`;

/**
 * Fund an address using Hardhat's hardhat_setBalance RPC method.
 * This is useful for tests where we need to ensure the wallet has ETH.
 */
async function fundAddressViaHardhat(
	address: string,
	amountInEth = '100',
): Promise<void> {
	// Convert ETH to wei (hex)
	const weiAmount = BigInt(parseFloat(amountInEth) * 1e18);
	const hexAmount = '0x' + weiAmount.toString(16);

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
		throw new Error(`Failed to set balance: ${response.statusText}`);
	}
}

export interface WalletOptions {
	/**
	 * Which burner account (index into IMPERSONATE_ADDRESSES) the connect flow
	 * picks in the account-picker dialog.
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
	 * Ensures the test wallet addresses have ETH on the Hardhat node.
	 * Call this before tests that need funded wallets.
	 */
	fundWallets: () => Promise<void>;
}

/**
 * Clear all browser storage (localStorage, sessionStorage) on the target origin.
 * This is called after navigating to the origin to ensure clean state.
 */
async function clearBrowserStorage(page: Page): Promise<void> {
	await page.evaluate(() => {
		localStorage.clear();
		sessionStorage.clear();
	});
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
	const deadline = Date.now() + 20_000;

	while (Date.now() < deadline) {
		const dialog = page.locator('[role="dialog"]');
		const dialogVisible = await dialog
			.first()
			.isVisible({timeout: 1000})
			.catch(() => false);

		if (!dialogVisible) {
			// No dialog: either connected (done) or the next modal has not opened
			// yet (transitions can lag under parallel test load). Only conclude
			// after the absence persists for a while.
			let gone = true;
			for (let i = 0; i < 6; i++) {
				await page.waitForTimeout(500);
				if (
					await dialog
						.first()
						.isVisible({timeout: 250})
						.catch(() => false)
				) {
					gone = false;
					break;
				}
			}
			if (gone) break;
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
}

/**
 * Handle the Insufficient Funds modal by clicking "Get ETH" and then "Continue Transaction".
 * This modal appears when the wallet is connected but doesn't have enough ETH.
 */
async function handleInsufficientFundsModal(page: Page): Promise<void> {
	const getEthButton = page.getByRole('button', {name: /get eth/i});

	try {
		// Wait for the button to exist in the DOM
		await getEthButton.waitFor({state: 'attached', timeout: 5000});

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
	} catch {
		// No insufficient funds modal or already handled
	}
}

/**
 * Wait for any pending transaction to be confirmed.
 * First waits for a pending indicator to appear (showing tx started),
 * then waits for all pending indicators to disappear (showing tx completed).
 */
async function waitForTransactionComplete(page: Page): Promise<void> {
	// First, wait for pending indicator to APPEAR (transaction started)
	// This ensures we don't return early if the transaction hasn't started yet
	try {
		await page.waitForFunction(
			() => {
				const pendingElements = document.querySelectorAll(
					'[class*="animate-spin"], [class*="Pending"]',
				);
				const pendingText = document.body.textContent?.includes(
					'Transaction pending',
				);
				return pendingElements.length > 0 || pendingText;
			},
			undefined,
			{timeout: 10000},
		);
	} catch {
		// Pending indicator might not appear if tx is very fast
		// Continue anyway and check for completion
	}

	// Then wait for ALL pending indicators to disappear (transaction completed)
	try {
		await page.waitForFunction(
			() => {
				const pendingElements = document.querySelectorAll(
					'[class*="animate-spin"], [class*="Pending"]',
				);
				const pendingText = document.body.textContent?.includes(
					'Transaction pending',
				);
				return pendingElements.length === 0 && !pendingText;
			},
			undefined,
			{timeout: 30000},
		);
	} catch {
		// Timeout - might still have pending indicators, but continue
	}

	// Give the UI a moment to settle
	await page.waitForTimeout(500);
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
		// Create a fresh context for this test with empty storage
		const context = await browser.newContext({
			storageState: {cookies: [], origins: []},
		});

		const page = await context.newPage();

		// Navigate to the app origin to establish context, then clear storage
		await page.goto(BASE_URL, {waitUntil: 'commit'});
		await page.evaluate(() => {
			localStorage.clear();
			sessionStorage.clear();
		});

		// Navigate away so the test's navigation starts fresh
		await page.goto('about:blank');

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
		// Fund the wallet addresses BEFORE navigating to the page
		// This ensures the wallet has ETH when the app auto-connects
		await fundWallets();

		// Navigate to demo page
		await page.goto('/demo');

		// Wait for app to initialize
		const input = page.getByPlaceholder('Enter your greeting...');
		await expect(input).toBeVisible({timeout: 30000});

		// Check if wallet is already connected (balance shown in navbar)
		const navbarBalance = page.locator('text=/\\d+\\.?\\d*\\s*ETH/');
		const isConnected = await navbarBalance
			.first()
			.isVisible({timeout: 5000})
			.catch(() => false);

		if (!isConnected) {
			// Fill input first to enable the button
			await input.fill('fixture-connection-test');

			// Click send to trigger wallet connection - use force to avoid timing issues
			const sendButton = page.getByRole('button', {name: /send/i});
			await sendButton.click({force: true});

			// Connect using Dev Mode (handles both connection modal and funding if needed)
			await connectWalletDevMode(page, walletAccountIndex);

			// Wait for the input to be enabled (it's disabled during submitting)
			// This also waits for the initial transaction to complete
			await expect(input).toBeEnabled({timeout: 120000});

			// Clear the input for tests
			await input.clear();
		}

		// Wait a moment for the UI to settle
		await page.waitForTimeout(500);

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
});

export {expect};

// Re-export describe for convenience
export const describe = test.describe;
