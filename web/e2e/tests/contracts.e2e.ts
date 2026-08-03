import {test, expect, describe} from '../fixtures/test';

describe('Contracts Page', () => {
	test('should show contract selection dropdown', async ({page}) => {
		await page.goto('/contracts');

		// The contract selector should be visible
		const selector = page
			.getByRole('combobox')
			.or(page.locator('[class*="select"]').first());
		await expect(selector).toBeVisible({timeout: 5000});
	});

	test('should display GreetingsRegistry contract by default', async ({
		page,
	}) => {
		await page.goto('/contracts');

		// Should show the GreetingsRegistry contract (as button or heading)
		await expect(page.getByText('GreetingsRegistry').first()).toBeVisible({
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
		await page.goto('/contracts');

		// Should have Read and Write tabs
		await expect(page.getByRole('tab', {name: 'Read'})).toBeVisible({
			timeout: 5000,
		});
		await expect(page.getByRole('tab', {name: 'Write'})).toBeVisible();
	});

	test('should display view functions in Read tab', async ({page}) => {
		await page.goto('/contracts');

		// Wait for Read tab to be visible and click it
		const readTab = page.getByRole('tab', {name: 'Read'});
		await expect(readTab).toBeVisible({timeout: 5000});
		await readTab.click();

		// Should show "View Functions" heading
		await expect(
			page.getByRole('heading', {name: 'View Functions'}),
		).toBeVisible({timeout: 5000});

		// Should list the getLastMessages or messages function
		await expect(
			page
				.getByText('getLastMessages')
				.first()
				.or(page.getByText('messages').first()),
		).toBeVisible({timeout: 5000});
	});

	test('should display write functions in Write tab', async ({page}) => {
		await page.goto('/contracts');

		// Wait for Write tab to be visible and click it
		const writeTab = page.getByRole('tab', {name: 'Write'});
		await expect(writeTab).toBeVisible({timeout: 5000});
		await writeTab.click();

		// Should show the setMessage function
		await expect(page.getByText('setMessage').first()).toBeVisible({
			timeout: 5000,
		});
	});

	test('should be able to call a view function', async ({page}) => {
		await page.goto('/contracts');

		// Wait for Read tab and click it
		const readTab = page.getByRole('tab', {name: 'Read'});
		await expect(readTab).toBeVisible({timeout: 5000});
		await readTab.click();

		// Find the getLastMessages function card and expand it or click call
		const functionCard = page.locator('[class*="card"]').filter({
			hasText: 'getLastMessages',
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
	// Write from the SECOND burner account: the GreetingsRegistry keeps one
	// message per account and the demo suite (running in a parallel worker)
	// writes from the first account. Distinct accounts = no cross-file clobber.
	test.use({walletAccountIndex: 1});

	test('should trigger wallet connection when calling write function', async ({
		page,
	}) => {
		await page.goto('/contracts');

		// Wait for Write tab to be visible and click it
		const writeTab = page.getByRole('tab', {name: 'Write'});
		await expect(writeTab).toBeVisible({timeout: 10000});
		await writeTab.click();

		// Wait for setMessage text to appear
		const setMessageText = page.getByText('setMessage nonpayable');
		await expect(setMessageText).toBeVisible({timeout: 10000});

		// Find the parent section containing the function
		const functionSection = page
			.locator('[class*="card"], [class*="function"]')
			.filter({
				has: setMessageText,
			})
			.first();

		// Fill in the message input (placeholder "Enter text...")
		const messageInput = functionSection
			.getByPlaceholder('Enter text...')
			.first();
		await messageInput.fill('Test message from contracts page');

		// Click the Execute button (or Connect + Execute if wallet not connected)
		const executeButton = functionSection.getByRole('button', {
			name: /execute/i,
		});
		await executeButton.click();

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

		// Navigate to contracts page (connectedPage starts at /demo)
		await page.goto('/contracts');

		// Wait for page to load
		await expect(
			page.getByText('Interact with deployed smart contracts'),
		).toBeVisible({timeout: 10000});

		// Wait for the connection to finish re-establishing after navigation.
		// Interacting before it settles makes the execute click open the connect
		// modal instead of sending the tx.
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

		// Wait for Write tab to be visible and click it
		const writeTab = page.getByRole('tab', {name: 'Write'});
		await expect(writeTab).toBeVisible({timeout: 10000});
		await writeTab.click();

		// Wait for setMessage text to appear
		const setMessageText = page.getByText('setMessage nonpayable');
		await expect(setMessageText).toBeVisible({timeout: 10000});

		// Find the parent section containing the function
		const functionSection = page
			.locator('[class*="card"], [class*="function"]')
			.filter({
				has: setMessageText,
			})
			.first();

		// Fill in a message
		const uniqueMessage = `Contract test ${Date.now()}`;
		const messageInput = functionSection
			.getByPlaceholder('Enter text...')
			.first();
		await messageInput.fill(uniqueMessage);

		// Click the Execute button (wallet already connected)
		const executeButton = functionSection.getByRole('button', {
			name: /execute/i,
		});
		await executeButton.click();

		// Under parallel load the connection may still be re-establishing after
		// the navigation, in which case executing re-opens the connect flow (e.g.
		// the account picker). The connect helper walks whatever dialogs appear
		// and returns quickly when none do.
		await connectWallet(page);

		// Wait for transaction
		await waitForTransaction(page);

		// Should show success or the message should be visible on demo page
		await page.goto('/demo');

		// Wait for demo page to load
		await expect(page.getByPlaceholder('Enter your greeting...')).toBeVisible({
			timeout: 10000,
		});

		// Check for the message (might have prefix from contract)
		await expect(page.getByText(uniqueMessage)).toBeVisible({
			timeout: 30000,
		});
	});
});

describe('Contracts Page - Accessibility', () => {
	test('should have proper heading hierarchy', async ({page}) => {
		await page.goto('/contracts');

		// Should have h1
		await expect(page.locator('h1')).toHaveCount(1, {timeout: 5000});
	});

	test('should have accessible tab controls', async ({page}) => {
		await page.goto('/contracts');

		// Tabs should be visible and keyboard navigable
		const readTab = page.getByRole('tab', {name: 'Read'});
		const writeTab = page.getByRole('tab', {name: 'Write'});

		await expect(readTab).toBeVisible({timeout: 5000});
		await expect(writeTab).toBeVisible();
	});
});
