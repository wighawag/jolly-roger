import {test, expect, describe} from '../fixtures/test';
import {MAIN_PAGE} from '../routes';
import {
	executeButton,
	fillWrite,
	openContract,
	openWrite,
	READ_FUNCTION,
	WRITE_CONTRACT,
	WRITE_FUNCTION,
} from '../fixtures/contracts-page';

describe('Contracts Page', () => {
	test('should show contract selection dropdown', async ({page}) => {
		await page.goto('/contracts');

		// The contract selector should be visible
		const selector = page
			.getByRole('combobox')
			.or(page.locator('[class*="select"]').first());
		await expect(selector).toBeVisible({timeout: 5000});
	});

	test("should display the main page's contract once selected", async ({
		page,
	}) => {
		await openContract(page);

		// Should show the contract (as button or heading)
		await expect(page.getByText(WRITE_CONTRACT).first()).toBeVisible({
			timeout: 5000,
		});
	});

	test('should display contract address', async ({page}) => {
		await page.goto('/contracts');

		// Should show an Ethereum address (0x...)
		const addressElement = page.locator('text=/0x[a-fA-F0-9]{4,}/');
		await expect(addressElement.first()).toBeVisible({timeout: 5000});
	});

	test('should have Read and Write tabs', async ({page}) => {
		await openContract(page);

		// Should have Read and Write tabs
		await expect(page.getByRole('tab', {name: 'Read'})).toBeVisible({
			timeout: 5000,
		});
		await expect(page.getByRole('tab', {name: 'Write'})).toBeVisible();
	});

	test('should display view functions in Read tab', async ({page}) => {
		await openContract(page);

		// Wait for Read tab to be visible and click it
		const readTab = page.getByRole('tab', {name: 'Read'});
		await expect(readTab).toBeVisible({timeout: 5000});
		await readTab.click();

		// Should show "View Functions" heading
		await expect(
			page.getByRole('heading', {name: 'View Functions'}),
		).toBeVisible({timeout: 5000});

		// Should list the contract's view function (`MAIN_PAGE.read`)
		await expect(page.getByText(READ_FUNCTION).first()).toBeVisible({
			timeout: 5000,
		});
	});

	test('should display write functions in Write tab', async ({page}) => {
		await openContract(page);

		// Wait for Write tab to be visible and click it
		const writeTab = page.getByRole('tab', {name: 'Write'});
		await expect(writeTab).toBeVisible({timeout: 5000});
		await writeTab.click();

		// Should show the write (`MAIN_PAGE.write`)
		await expect(page.getByText(WRITE_FUNCTION).first()).toBeVisible({
			timeout: 5000,
		});
	});

	test('should be able to call a view function', async ({page}) => {
		await openContract(page);

		// Wait for Read tab and click it
		const readTab = page.getByRole('tab', {name: 'Read'});
		await expect(readTab).toBeVisible({timeout: 5000});
		await readTab.click();

		// Find the view function's card and expand it or click call
		const functionCard = page.locator('[class*="card"]').filter({
			hasText: READ_FUNCTION,
		});

		// If there's a limit input, fill it
		const limitInput = functionCard
			.locator('input[type="text"], input[type="number"]')
			.first();
		if (await limitInput.isVisible({timeout: 500}).catch(() => false)) {
			await limitInput.fill('10');
		}

		// Click the call/query button
		const callButton = functionCard.getByRole('button', {
			name: /call|query|read/i,
		});
		if (await callButton.isVisible({timeout: 500}).catch(() => false)) {
			await callButton.click();

			// Wait for result - look for success indicator or result display
			await page
				.waitForFunction(
					() => {
						const hasResult = document.querySelector(
							'[class*="result"], [class*="output"]',
						);
						const hasSuccess =
							document.body.textContent?.match(/success|result|\[\]/i);
						return hasResult || hasSuccess;
					},
					{timeout: 5000},
				)
				.catch(() => {});

			// Should show some result (either data or empty array)
			const hasResult = await page
				.locator('[class*="result"], [class*="output"]')
				.isVisible()
				.catch(() => false);
			const hasSuccess = await page
				.getByText(/success|result|\[\]/i)
				.isVisible()
				.catch(() => false);
			expect(hasResult || hasSuccess).toBe(true);
		}
	});
});

describe('Contracts Page - Write Functions', () => {
	// Its own burner account: files run in parallel workers, and two files
	// sending from the same account race each other for a nonce (and the
	// greetings demo keeps one message per account, which the demo suite writes
	// from the first).
	test.use({walletAccountIndex: 1});

	test('should trigger wallet connection when calling write function', async ({
		page,
	}) => {
		await openWrite(page);
		await fillWrite(page, 'Test message from contracts page');

		// Click the Execute button (or Connect + Execute if wallet not connected)
		await executeButton(page).click();

		// If wallet is not connected, some step of the connect flow should appear:
		// the connect entry (dev-mode or wallet button), or, when the single wallet
		// auto-selects, the account picker or sign-in confirm step directly.
		// If wallet is already connected, the transaction is submitted directly.
		const connectFlowStep = page
			.getByRole('button', {name: /dev mode/i})
			.or(page.getByRole('button', {name: /connect .*wallet/i}))
			.or(page.getByText(/accounts available, choose one/i))
			.or(page.getByText(/confirm sign in/i))
			.first();
		// (isVisible does not wait; waitFor does.)
		const isConnectFlowVisible = await connectFlowStep
			.waitFor({state: 'visible', timeout: 5000})
			.then(() => true)
			.catch(() => false);

		// Test passes if either:
		// 1. A connect-flow step appeared (wallet not connected)
		// 2. Transaction submitted alert appeared (wallet already connected)
		if (!isConnectFlowVisible) {
			// Check for transaction submitted alert (wallet was already connected)
			const txAlert = page.getByText(/transaction submitted|tx submitted/i);
			await expect(txAlert.first()).toBeVisible({timeout: 10000});
		}
	});

	test('should execute write function after connecting', async ({
		connectedPage,
		connectWallet,
		waitForTransaction,
	}) => {
		// Full end-to-end flow (connect fixture + write + cross-page verification):
		// slow under parallel suite load, so triple the timeout.
		test.slow();

		const page = connectedPage;

		// To /contracts by a client-side navigation (connectedPage starts on the
		// main page), so the connection it made is the one the write uses.
		await openWrite(page);

		// Wait for the connection to be the app's before executing: interacting
		// before it settles makes the execute click open the connect modal instead
		// of sending the tx.
		//
		// Assert the app's own connection flag: waiting for the "Loading Connect"
		// button to be hidden is satisfied both when connected AND when plainly
		// disconnected (that button only exists mid-connect), so it could fall
		// through with no wallet attached.
		await expect(page.locator('[data-testid="wallet-status"]')).toHaveAttribute(
			'data-connected',
			'true',
			{timeout: 30000},
		);

		const label = `Contract test ${Date.now()}`;
		await fillWrite(page, label);
		await executeButton(page).click();

		// Under parallel load the connection may still be re-establishing, in
		// which case executing re-opens the connect flow (e.g. the account picker).
		// The connect helper walks whatever dialogs appear and returns quickly when
		// none do.
		await connectWallet(page);

		// IT ACTUALLY HAPPENED, asserted before waiting for it to settle:
		// `waitForTransaction` only checks that nothing is pending, which is also
		// true of a page that sent nothing (template-commit-reveal's copy of this
		// test once passed for a year without executing a write). An operation in
		// account data is the app's own evidence that the write left the page, on
		// a node whose main page shows nothing of it as on one that does. Not the
		// navbar badge: against an instant-mining node it is open for a few hundred
		// milliseconds.
		await expect
			.poll(
				async () =>
					page.evaluate(() => {
						const ctx = (globalThis as any).context;
						let ops: Record<string, unknown> = {};
						ctx.accountData
							.watchField('operations')
							.subscribe((v: Record<string, unknown>) => (ops = v))();
						return Object.keys(ops ?? {}).length;
					}),
				{message: 'the write should record an operation', timeout: 30000},
			)
			.toBeGreaterThan(0);

		// ...and every in-flight operation settled.
		await waitForTransaction(page);

		// Where the main page shows what the write sent (the greetings demo
		// does), read it back there; a write that shows nothing is done once mined.
		if (MAIN_PAGE.write.shownOnMainPage) {
			await page.goto(MAIN_PAGE.route);
			// The label might carry a prefix from the contract.
			await expect(page.getByText(label)).toBeVisible({timeout: 30000});
		}
	});
});

describe('Contracts Page - Accessibility', () => {
	test('should have proper heading hierarchy', async ({page}) => {
		await page.goto('/contracts');

		// Should have h1
		await expect(page.locator('h1')).toHaveCount(1, {timeout: 5000});
	});

	test('should have accessible tab controls', async ({page}) => {
		await openContract(page);

		// Tabs should be visible and keyboard navigable
		const readTab = page.getByRole('tab', {name: 'Read'});
		const writeTab = page.getByRole('tab', {name: 'Write'});

		await expect(readTab).toBeVisible({timeout: 5000});
		await expect(writeTab).toBeVisible();
	});
});
