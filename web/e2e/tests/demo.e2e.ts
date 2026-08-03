import {test, expect, describe} from '../fixtures/test';

describe('Demo Page - Greetings Registry', () => {
	// All these tests submit greetings from the SAME burner account against the
	// SAME shared contract, and the GreetingsRegistry keeps only ONE message per
	// account (a new setMessage replaces the previous one). Under the global
	// fullyParallel config they would overwrite each other's message mid-test,
	// which is exactly what made "should replace previous message from same
	// account" flaky. Run them serially so each test owns the account's single
	// message for the duration of its assertions.
	// See work/notes/findings/e2e-demo-tests-share-one-burner-account.md
	describe.configure({mode: 'serial'});

	test('should show input field for greeting', async ({page}) => {
		await page.goto('/demo');

		// Check that the greeting input is visible
		await expect(page.getByPlaceholder('Enter your greeting...')).toBeVisible();

		// Check that the send button is visible
		await expect(page.getByRole('button', {name: /send/i})).toBeVisible();
	});

	test('should show send button as disabled when input is empty', async ({
		page,
	}) => {
		await page.goto('/demo');

		// Wait for the input to be visible first
		await expect(page.getByPlaceholder('Enter your greeting...')).toBeVisible({
			timeout: 10000,
		});

		const sendButton = page.getByRole('button', {name: /send/i});

		// Button should be disabled when input is empty
		await expect(sendButton).toBeDisabled();

		// Type something
		await page.getByPlaceholder('Enter your greeting...').fill('Hello!');

		// Button should now be enabled. It stays disabled while the app context
		// is still initializing (loading state), which can take a while under
		// parallel test load, so allow a generous timeout.
		await expect(sendButton).toBeEnabled({timeout: 30000});
	});

	test('should connect wallet and submit when clicking send', async ({
		connectedPage,
		connectWallet,
		waitForTransaction,
	}) => {
		const page = connectedPage;

		// Use a unique greeting for this test
		const uniqueGreeting = `Connect test ${Date.now()}`;

		// Fill in a greeting
		const input = page.getByPlaceholder('Enter your greeting...');
		await input.fill(uniqueGreeting);

		// Wait for the send button to be enabled
		const sendButton = page.getByRole('button', {name: /send/i});
		await expect(sendButton).toBeEnabled({timeout: 10000});

		// Click send
		await sendButton.click();

		// Under parallel load the connection may still be re-establishing, in
		// which case sending re-opens the connect flow (e.g. the account picker).
		// The connect helper walks whatever dialogs appear and returns quickly
		// when none do.
		await connectWallet(page);

		// Wait for the transaction to complete
		await waitForTransaction(page);

		// The greeting should appear in the messages list
		const messageCard = page
			.locator('[class*="rounded-lg border px-4 py-3"]')
			.filter({
				hasText: uniqueGreeting,
			});
		await expect(messageCard).toBeVisible({timeout: 60000});

		// Wallet should be connected (balance shown in navbar)
		const navbarBalance = page.locator('text=/\\d+\\.?\\d*\\s*ETH/');
		await expect(navbarBalance.first()).toBeVisible({timeout: 10000});
	});

	test('should show wallet as connected after submitting', async ({
		connectedPage,
		submitGreeting,
	}) => {
		const page = connectedPage;

		await submitGreeting(page, `Wallet test ${Date.now()}`);

		// The wallet is still connected after the write. Assert the app's own
		// connection flag rather than the navbar balance text: the balance renders
		// empty while loading, so asserting on it tested render timing, not
		// connection state.
		await expect(page.locator('[data-testid="wallet-status"]')).toHaveAttribute(
			'data-connected',
			'true',
		);
	});

	test('should submit a greeting and see it in the list', async ({
		connectedPage,
		submitGreeting,
	}) => {
		const page = connectedPage;
		const uniqueGreeting = `E2E Test ${Date.now()}`;

		// submitGreeting asserts the row appears AND settles, which is exactly what
		// this test is about.
		await submitGreeting(page, uniqueGreeting);
		await expect(page.getByText(uniqueGreeting)).toBeVisible();
	});

	test('should display existing messages with avatars', async ({page}) => {
		await page.goto('/demo');

		// Wait for the page to fully load (not just loading state)
		await page.waitForLoadState('networkidle', {timeout: 30000});

		// Wait for either messages or the input field to be visible
		await expect(page.getByPlaceholder('Enter your greeting...')).toBeVisible({
			timeout: 10000,
		});

		// Check for message cards
		const messageCard = page.locator('[class*="rounded-lg border px-4 py-3"]');

		// Wait for either messages to appear or the empty state
		const hasMessages = await messageCard
			.first()
			.isVisible({timeout: 15000})
			.catch(() => false);

		if (hasMessages) {
			// Check that the message card has an image element (avatar)
			const firstCard = messageCard.first();
			const imgCount = await firstCard.locator('img').count();
			expect(imgCount).toBeGreaterThanOrEqual(1);
		} else {
			// Empty state - check for text indicating no messages
			// The page shows "No messages yet. Be the first!" when empty
			const hasNoMessagesText = await page
				.getByText(/no messages yet/i)
				.isVisible()
				.catch(() => false);
			const hasBeFirstText = await page
				.getByText(/be the first/i)
				.isVisible()
				.catch(() => false);
			expect(hasNoMessagesText || hasBeFirstText).toBe(true);
		}
	});

	test('should show "Just now" for recent messages', async ({
		connectedPage,
		submitGreeting,
	}) => {
		const page = connectedPage;
		const uniqueGreeting = `Fresh message ${Date.now()}`;

		await submitGreeting(page, uniqueGreeting);

		// Scope the timestamp to THIS message's row. `getByText('Just now').first()`
		// passed as long as any row was recent, so it could go green on a sibling
		// test's message while this one had not landed.
		const row = page
			.locator('[data-testid="message-row"]')
			.filter({hasText: uniqueGreeting});
		await expect(row.getByText('Just now')).toBeVisible();
	});

	test('should clear input after successful submission', async ({
		connectedPage,
		submitGreeting,
	}) => {
		const page = connectedPage;
		const input = page.getByPlaceholder('Enter your greeting...');

		await submitGreeting(page, `Clear test ${Date.now()}`);

		await expect(input).toBeEnabled();
		await expect(input).toHaveValue('');
	});

	test('should replace previous message from same account', async ({
		connectedPage,
		submitGreeting,
	}) => {
		const page = connectedPage;

		// The contract allows only ONE message per account - new messages replace old ones
		const timestamp = Date.now();
		const message1 = `First ${timestamp}`;
		const message2 = `Second ${timestamp}`;

		// Each submit is only complete once it has settled on-chain; submitting the
		// second while the first was still in flight was a source of flake.
		await submitGreeting(page, message1);
		await submitGreeting(page, message2);

		// The invariant that actually holds: one message per account. After the
		// replacement, message2 is present and message1 is gone.
		await expect(page.getByText(message2)).toBeVisible();
		await expect(page.getByText(message1)).toHaveCount(0);
	});
});

describe('Demo Page - Accessibility', () => {
	test('should have proper heading hierarchy', async ({page}) => {
		await page.goto('/demo');

		// There should be exactly one h1
		await expect(page.locator('h1')).toHaveCount(1);
	});

	test('should have accessible form elements', async ({page}) => {
		await page.goto('/demo');

		// Input should have a placeholder (acts as label)
		const input = page.getByPlaceholder('Enter your greeting...');
		await expect(input).toBeVisible();

		// Button should be accessible
		const button = page.getByRole('button', {name: /send/i});
		await expect(button).toBeVisible();
	});
});
