import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';

/**
 * The transaction inspector, driven the way a user reaches it.
 *
 * Its unit tests cover the registry's rules; this covers the wiring those rules
 * sit on: a real operation in account data, a real click, a real URL. The
 * symptom it exists to catch is precise, and would pass every unit test: the
 * URL gains `?operation=<id>` and no dialog appears. That was real, and its
 * cause was that SvelteKit's `pushState` deliberately leaves `page.url` on the
 * route the page is showing, so the app read a URL without the param it had
 * just written and closed the overlay it had just opened.
 */
describe('Transaction inspector', () => {
	// Sends transactions, so it takes its own burner account: files run in
	// parallel workers and two sending from the same account race for a nonce.
	test.use({walletAccountIndex: 2});

	// And serially WITHIN the file, for the same reason: `fullyParallel` applies
	// to tests, not just files, so these three would otherwise race each other
	// from that one account. Same rule, same cause, as the demo suite.
	describe.configure({mode: 'serial'});

	/**
	 * Leave an operation in account data and land on the transactions page.
	 *
	 * Two things here are deliberate, and both were learned by watching this fail.
	 *
	 * The WAIT: account data records an operation only once the transaction is
	 * broadcast, so leaving straight after the click abandons the send and the
	 * page has nothing to list. The navbar's pending badge is the app's own signal
	 * that an operation now exists.
	 *
	 * The CLIENT-SIDE navigation: `page.goto` is a full load, and account data is
	 * persisted asynchronously, so a reload immediately after the badge appears
	 * can discard an operation that was only ever in memory. Going through the
	 * menu is both what a user does and what keeps the app alive.
	 */
	async function submitAndOpenTransactions(page: Page, message: string) {
		const input = page.getByPlaceholder('Enter your greeting...');
		await expect(input).toBeEnabled({timeout: 30000});
		await input.fill(message);
		await page.getByRole('button', {name: /send/i}).click();

		await expect(
			page.locator('[data-testid="pending-operations"]'),
			'an operation should be recorded before leaving the page',
		).toBeVisible({timeout: 30000});

		const drawer = page.getByRole('dialog');
		await expect(async () => {
			await page.getByLabel('Open menu').click();
			await expect(drawer).toBeVisible({timeout: 2000});
		}).toPass({timeout: 30000});
		await drawer.getByRole('link', {name: /your transactions/i}).click();

		await expect(page.getByRole('heading', {name: 'Transactions'})).toBeVisible(
			{timeout: 10000},
		);
	}

	test('opens the inspector and puts the operation in the URL', async ({
		connectedPage,
	}) => {
		const page = connectedPage;
		await submitAndOpenTransactions(page, `Inspect test ${Date.now()}`);

		const inspect = page.getByRole('button', {name: /inspect/i}).first();
		await expect(inspect).toBeVisible({timeout: 30000});
		await inspect.click();

		// Addressable: the operation id is in the URL, which is what makes the
		// inspector survive a reload and the back gesture close it.
		await expect(page).toHaveURL(/[?&]operation=/, {timeout: 10000});

		// And the modal is on screen. The bug was that this did not follow from
		// the URL having changed.
		await expect(page.getByRole('dialog')).toBeVisible({timeout: 10000});
		await expect(
			page.getByRole('dialog').getByText('Pending Transaction'),
		).toBeVisible();
	});

	test('closes on the back gesture, leaving the transactions page', async ({
		connectedPage,
	}) => {
		const page = connectedPage;
		await submitAndOpenTransactions(page, `Back test ${Date.now()}`);

		await page
			.getByRole('button', {name: /inspect/i})
			.first()
			.click();
		await expect(page.getByRole('dialog')).toBeVisible({timeout: 10000});

		await page.goBack();

		await expect(page.getByRole('dialog')).toHaveCount(0);
		// The param goes with it: the overlay is not open, so it is not addressed.
		await expect(page).not.toHaveURL(/[?&]operation=/);
		await expect(
			page.getByRole('heading', {name: 'Transactions'}),
		).toBeVisible();
	});

	test('survives a reload, because it is in the URL', async ({
		connectedPage,
	}) => {
		const page = connectedPage;
		await submitAndOpenTransactions(page, `Reload test ${Date.now()}`);

		await page
			.getByRole('button', {name: /inspect/i})
			.first()
			.click();
		await expect(page.getByRole('dialog')).toBeVisible({timeout: 10000});

		const addressed = page.url();
		const operationId = new URL(addressed).searchParams.get('operation');
		expect(operationId, 'the inspector addresses an operation').toBeTruthy();

		// Account data is persisted asynchronously, so reloading the instant the
		// dialog appears can discard an operation that was still only in memory,
		// and the inspector then correctly reports it as gone. Wait for the write
		// first: this test is about the URL surviving a reload, not about racing
		// storage.
		await expect
			.poll(
				async () =>
					page.evaluate((id) => {
						for (let i = 0; i < localStorage.length; i++) {
							const key = localStorage.key(i);
							if (key && (localStorage.getItem(key) ?? '').includes(id)) {
								return true;
							}
						}
						return false;
					}, operationId as string),
				{timeout: 15000},
			)
			.toBe(true);

		await page.goto(addressed);

		// The OPERATION is back, not merely some dialog: a cleared or unknown
		// operation now renders its own dialog too, so asserting on the dialog
		// alone would pass for the failure this test exists to catch.
		await expect(
			page.getByRole('dialog').getByText('Pending Transaction'),
		).toBeVisible({timeout: 30000});
	});
});
