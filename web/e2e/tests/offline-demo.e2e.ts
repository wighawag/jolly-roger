import {test, expect, describe} from '../fixtures/test';

// THE OFFLINE DEMO END TO END: a chain in the tab, the app's deploy on it, the
// world's own wallet, and a greeting sent through all of it. Nothing here
// touches the suite's chain: the world is the tab's.
//
// WHAT IT PINS, beside the demo itself. The world connects its own wallet AT
// BOOT (`$lib/offline-world`'s `connectTheWorld`), so its connection has
// reached the app's target step before the player does anything. And it sends
// through that connection with no dialog to answer: on a branch that signs in
// and holds a local signer, the world signs in and authorises its key itself,
// so a dialog here is a failure, not something to click through.

const MESSAGE_ROW = '[data-testid="message-row"]';
const MESSAGE_PENDING = '[data-testid="message-pending"]';
const CHAIN_ID = '[data-testid="offline-chain-id"]';

/**
 * The world's connection, read off the console handle `$lib/offline` installs
 * (`globalThis.offlineWorld`): whether it is at the step the app targets.
 * Runs in the page.
 */
function worldIsAtItsTarget(): boolean {
	type Store = {
		subscribe(run: (value: {step: string}) => void): () => void;
		targetStep: string;
	};
	const world = (
		globalThis as unknown as {offlineWorld?: {context: {connection: Store}}}
	).offlineWorld;
	if (!world) return false;
	const connection = world.context.connection;
	let step = '';
	connection.subscribe((value) => (step = value.step))();
	return step === connection.targetStep;
}

describe('Offline demo - a chain in this tab', () => {
	test('boots its world, connects it, and sends a greeting on it', async ({
		page,
	}) => {
		await page.goto('/offline-demo');

		// The world is up: the banner names its chain.
		await expect(
			page.getByText('This demo runs on a test chain inside this tab'),
		).toBeVisible({timeout: 90_000});

		// Connected at boot: the world's connection reaches the app's target step
		// before anything is clicked.
		await expect
			.poll(() => page.evaluate(worldIsAtItsTarget), {timeout: 60_000})
			.toBe(true);
		await expect(page.getByText('No messages yet. Be the first!')).toBeVisible({
			timeout: 60_000,
		});

		// TWICE, and not for thoroughness: every send after the first used to
		// fail with "Could not load balance" (QA F4, 2026-11-24). The funds check
		// read a balance store nothing in the world subscribes to, and peeking at
		// such a store with `get()` reset it under the check's feet. One send
		// never saw it.
		const input = page.getByPlaceholder('Enter your greeting...');
		const send = page.getByRole('button', {name: /send/i});
		for (const n of [1, 2]) {
			const message = `Offline ${n} ${Date.now()}`;
			await expect(input).toBeEnabled({timeout: 30_000});
			await input.fill(message);
			await expect(send).toBeEnabled({timeout: 30_000});
			await send.click();

			const row = page.locator(MESSAGE_ROW).filter({hasText: message});
			await expect(row, `greeting ${n} should appear in the list`).toBeVisible({
				timeout: 60_000,
			});
			await expect(
				row.locator(MESSAGE_PENDING),
				`greeting ${n} should settle on the world`,
			).toHaveCount(0, {timeout: 60_000});
		}
		// No dialog was needed to get here.
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test("shows the world's own overlays, not only the app's", async ({page}) => {
		// A failed send's toast offers "Details", which opens the error details
		// of the context the page runs in: here the WORLD's. The overlays in the
		// layout are bound to the app's context, so before the world mounted its
		// own (`$lib/context/InWorld.svelte`) the button did nothing (QA F5).
		await page.goto('/offline-demo');
		await expect
			.poll(() => page.evaluate(worldIsAtItsTarget), {timeout: 90_000})
			.toBe(true);

		await page.evaluate(() => {
			const world = (
				globalThis as unknown as {
					offlineWorld: {
						context: {
							errorDetails: {show(details: string, title?: string): void};
						};
					};
				}
			).offlineWorld;
			world.context.errorDetails.show('the world says hello', 'World error');
		});
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({timeout: 10_000});
		await expect(dialog).toContainText('World error');
		await expect(dialog).toContainText('the world says hello');
	});

	test('starts a fresh chain in the tab, on a new id and with nothing on it', async ({
		page,
	}) => {
		// QA F8: there was no way to throw the tab's chain away short of clearing
		// the site's data, which also wipes the app's own wallet and settings.
		await page.goto('/offline-demo');
		await expect
			.poll(() => page.evaluate(worldIsAtItsTarget), {timeout: 90_000})
			.toBe(true);
		const before = (await page.locator(CHAIN_ID).textContent())?.trim();
		expect(before).toMatch(/^\d+$/);

		// Something on the chain to lose.
		const message = `Before the reset ${Date.now()}`;
		const input = page.getByPlaceholder('Enter your greeting...');
		await expect(input).toBeEnabled({timeout: 30_000});
		await input.fill(message);
		await page.getByRole('button', {name: /send/i}).click();
		const row = page.locator(MESSAGE_ROW).filter({hasText: message});
		await expect(row).toBeVisible({timeout: 60_000});
		await expect(row.locator(MESSAGE_PENDING)).toHaveCount(0, {
			timeout: 60_000,
		});

		// It asks first, and cancelling keeps the chain.
		await page.getByTestId('start-fresh-chain').click();
		await expect(page.getByTestId('confirm-fresh-chain')).toBeVisible();
		await page.getByRole('button', {name: 'Cancel'}).click();
		await expect(page.locator(CHAIN_ID)).toHaveText(before!);
		await expect(row).toBeVisible();

		// Confirmed: the page reloads into a new chain.
		await page.getByTestId('start-fresh-chain').click();
		await page.getByTestId('confirm-start-fresh-chain').click();
		await expect(page.locator(CHAIN_ID)).not.toHaveText(before!, {
			timeout: 90_000,
		});
		const after = (await page.locator(CHAIN_ID).textContent())?.trim();
		expect(after).toMatch(/^\d+$/);
		expect(after).not.toBe(before);
		await expect
			.poll(() => page.evaluate(worldIsAtItsTarget), {timeout: 60_000})
			.toBe(true);
		await expect(page.getByText('No messages yet. Be the first!')).toBeVisible({
			timeout: 60_000,
		});
		await expect(
			page.locator(MESSAGE_ROW).filter({hasText: message}),
		).toHaveCount(0);

		// And it stays fresh across a reload: the new id is the one remembered.
		await page.reload();
		await expect(page.locator(CHAIN_ID)).toHaveText(after!, {timeout: 90_000});
	});
});
