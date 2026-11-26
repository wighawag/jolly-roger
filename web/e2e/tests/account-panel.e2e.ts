import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';
import {waitForAppReady} from '../fixtures/test';
import {
	installStallingWallet,
	STALLING_WALLET_ACCOUNTS,
	STALLING_WALLET_NAME,
} from '../fixtures/stalling-wallet';

/**
 * The account row of the navbar panel: copying the address, and switching
 * between the wallet's accounts.
 *
 * WHY ONE ACCOUNT IS ITS OWN CASE (QA F2). The row used to be the collapsible's
 * trigger, a `<button>` disabled when the wallet exposes one account, and the
 * address's copy control is a `<button>` inside it. A browser delivers no click
 * to the content of a disabled button, so with Rabby (which always exposes one
 * account) the copy icon did nothing, while anyone testing with several MetaMask
 * accounts saw it work. The burner wallet every other suite drives exposes ten,
 * which is exactly the configuration that hid the bug, so this suite drives the
 * stalling wallet instead: a real EIP-6963 wallet that lists one account unless
 * told otherwise.
 *
 * NOTHING IS SENT. The suite claims stalling account 2 anyway (checked by
 * test/e2e-account-claims.test.ts), so the address the panel shows is its own,
 * and the second account of the switcher case is listed, never signed from.
 */
describe('Navbar account panel', () => {
	test.use({permissions: ['clipboard-read', 'clipboard-write']});

	const nodeUrl =
		(globalThis as any).process.env.E2E_RPC_URL ||
		`http://127.0.0.1:${(globalThis as any).process.env.E2E_RPC_PORT || '8545'}`;

	const OWN = STALLING_WALLET_ACCOUNTS[2];
	/** Hardhat #6: listed by the wallet in the switcher case, and never sent from. */
	const OTHER = '0x976EA74026E726554dB657fA54763abd0C3a0aa9';

	const drawerOf = (page: Page) =>
		page.locator('#--layer-drawer [role="dialog"]');
	const accountRow = (page: Page) =>
		drawerOf(page).getByTestId('navbar-account');

	const connectedAddress = (page: Page): Promise<string | undefined> =>
		page.evaluate(
			() =>
				(globalThis as any).get((globalThis as any).context.connection).account
					?.address,
		);

	const clipboard = (page: Page): Promise<string> =>
		page.evaluate(() => navigator.clipboard.readText());

	/**
	 * Answer whatever the connect flow puts up until `done`: the wallet list
	 * (this wallet, behind a "Connect a wallet" button when the app also offers
	 * email or social), the account picker (the first, the wallet's own
	 * account) and, in an app that signs in, the sign-in confirmation. Each only
	 * IF it shows: an app whose only wallet is this one (mandalas, which has no
	 * burner) connects straight away, with no list at all. Every click is bounded,
	 * because these dialogs close underneath them (see waitUntilHolding in the
	 * stalling-wallet fixture for what an unbounded one costs).
	 */
	async function settleConnectFlow(page: Page, done: () => Promise<boolean>) {
		const deadline = Date.now() + 45_000;
		while (Date.now() < deadline) {
			if (await done().catch(() => false)) return;
			for (const choice of [
				page.getByRole('button', {name: /^connect a wallet$/i}),
				page.getByRole('button', {
					name: new RegExp(STALLING_WALLET_NAME, 'i'),
				}),
			]) {
				if (await choice.isVisible().catch(() => false)) {
					await choice.click({timeout: 5_000}).catch(() => {});
				}
			}
			const dialog = page.locator('[role="dialog"]').filter({
				hasText: /accounts? available, choose one|confirm sign in/i,
			});
			if (
				await dialog
					.first()
					.isVisible()
					.catch(() => false)
			) {
				const rows = dialog.first().locator('.overflow-y-auto > button');
				const text =
					(await dialog
						.first()
						.textContent()
						.catch(() => '')) ?? '';
				if (/choose one/i.test(text) || (await rows.count()) > 0) {
					await rows
						.first()
						.click({timeout: 5_000})
						.catch(() => {});
				}
				await page
					.getByRole('button', {name: /^sign in$/i})
					.click({timeout: 5_000})
					.catch(() => {});
			}
			await page.waitForTimeout(250);
		}
		expect(await done(), 'the connect flow never settled').toBe(true);
	}

	const isConnectedAs = (page: Page, address: string) => async () =>
		(await page
			.locator('[data-testid="wallet-status"]')
			.getAttribute('data-connected')) === 'true' &&
		(await connectedAddress(page))?.toLowerCase() === address.toLowerCase();

	async function connect(page: Page, alsoLists: `0x${string}`[] = []) {
		await installStallingWallet(page, {
			nodeUrl,
			stallingAccountIndex: 2,
			alsoLists,
		});
		await page.goto('/');
		await waitForAppReady(page);
		// Retried for the same hydration reason as the drawer below, until the
		// flow has started: a dialog is up, or the enabled Connect button is gone
		// (an app with one wallet connects without asking).
		const connectButton = page
			.locator('[data-testid="wallet-status"]')
			.getByRole('button', {name: /^connect$/i});
		const connectOffered = async () =>
			(await connectButton.count()) > 0 &&
			(await connectButton
				.first()
				.isEnabled({timeout: 1000})
				.catch(() => false));
		await expect(async () => {
			if (await connectOffered()) {
				await connectButton.click({timeout: 2000});
				await page.waitForTimeout(500);
			}
			expect(
				(await page.locator('[role="dialog"]').count()) > 0 ||
					!(await connectOffered()),
			).toBe(true);
		}).toPass({timeout: 30000});
		await settleConnectFlow(page, isConnectedAs(page, OWN));
	}

	/** Retried: a click during hydration is swallowed (see overlays.e2e.ts). */
	async function openDrawer(page: Page) {
		await expect(async () => {
			await page.getByLabel('Open menu').click();
			await expect(drawerOf(page)).toBeVisible({timeout: 2000});
		}).toPass({timeout: 30000});
	}

	test('copies the address when the wallet exposes ONE account', async ({
		page,
	}) => {
		await connect(page);
		await openDrawer(page);

		// The account's copy control is the drawer's first: the account section
		// opens the panel. Found by its role rather than by the row's test id, so
		// this is the same click with or without the F2 fix.
		await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
		await drawerOf(page)
			.getByRole('button', {name: 'Copy address', exact: true})
			.first()
			.click({timeout: 10_000});

		await expect
			.poll(async () => (await clipboard(page)).toLowerCase())
			.toBe(OWN.toLowerCase());

		// One account: nothing to switch to, so no trigger is offered.
		await expect(accountRow(page)).toBeVisible();
		await expect(
			drawerOf(page).getByRole('button', {name: 'Switch account'}),
		).toHaveCount(0);
	});

	test('with several accounts, lists them, copies any, and switches', async ({
		page,
	}) => {
		await connect(page, [OTHER]);
		await openDrawer(page);

		// The current account's copy works with a list to open, too.
		await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
		await accountRow(page)
			.getByRole('button', {name: 'Copy address', exact: true})
			.click();
		await expect
			.poll(async () => (await clipboard(page)).toLowerCase())
			.toBe(OWN.toLowerCase());

		await drawerOf(page).getByRole('button', {name: 'Switch account'}).click();
		const options = drawerOf(page).getByTestId('navbar-account-option');
		await expect(options).toHaveCount(2);
		const current = options.filter({hasText: '(current)'});
		const other = options.filter({hasNotText: '(current)'});
		await expect(current).toHaveCount(1);

		// A listed account's own copy button, beside the switch rather than in it.
		await other
			.getByRole('button', {name: 'Copy address', exact: true})
			.click();
		await expect
			.poll(async () => (await clipboard(page)).toLowerCase())
			.toBe(OTHER.toLowerCase());

		await other.getByRole('button', {name: 'Switch', exact: true}).click();
		await settleConnectFlow(page, isConnectedAs(page, OTHER));
	});
});
