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
			page.getByText('Everything below runs against a chain inside this tab'),
		).toBeVisible({timeout: 90_000});

		// Connected at boot: the world's connection reaches the app's target step
		// before anything is clicked.
		await expect
			.poll(() => page.evaluate(worldIsAtItsTarget), {timeout: 60_000})
			.toBe(true);
		await expect(page.getByText('No messages yet. Be the first!')).toBeVisible({
			timeout: 60_000,
		});

		const message = `Offline ${Date.now()}`;
		const input = page.getByPlaceholder('Enter your greeting...');
		await expect(input).toBeEnabled({timeout: 30_000});
		await input.fill(message);
		const send = page.getByRole('button', {name: /send/i});
		await expect(send).toBeEnabled({timeout: 30_000});
		await send.click();

		const row = page.locator(MESSAGE_ROW).filter({hasText: message});
		await expect(row, 'the greeting should appear in the list').toBeVisible({
			timeout: 60_000,
		});
		await expect(
			row.locator(MESSAGE_PENDING),
			'the greeting should settle on the world',
		).toHaveCount(0, {timeout: 60_000});
		// No dialog was needed to get here.
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});
});
