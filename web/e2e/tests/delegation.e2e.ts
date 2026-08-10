import {test, expect, describe, connectPaymentWallet} from '../fixtures/test';

/**
 * Greetings belong to the ACCOUNT, not to the key that signs them.
 *
 * The app sends from a signer this browser holds, and the registry files the
 * greeting under the account that signer is registered to act for. Getting
 * there takes one transaction, and there is more than one way to pay for it, so
 * these cover the two routes a browser can actually take here:
 *
 *  - direct: the account pays and sends `registerDelegate` itself, so sending
 *    IS the proof and no signature exists;
 *  - live signature: another wallet pays, and the account's own wallet is asked
 *    to sign the authorisation first, after being told what it means.
 *
 * The pre-signed route (an account whose key lives at a wallet host) cannot be
 * reached from here, because this configuration has no such account. It is
 * covered in test/lib/ui/credits/top-up-flow.test.ts, along with the collapse
 * onto the direct route and the empty set of payment methods.
 */

// Its own wallet account, so these writes cannot race the demo suite's (which
// uses index 0). See the note on `walletAccountIndex` in the fixtures.
test.use({walletAccountIndex: 2});

/** The account the app is signed in as, read from its own stores. */
async function readStore(page: import('@playwright/test').Page, name: string) {
	return page.evaluate((storeName) => {
		const read = (store: any) => {
			let value: any;
			store.subscribe((v: any) => (value = v))();
			return value;
		};
		return read((globalThis as any).context[storeName]);
	}, name);
}

describe('Delegation - authorising this browser', () => {
	// Each test writes a greeting from the account it signs in as, and the
	// registry keeps ONE message per account. They also share one chain.
	describe.configure({mode: 'serial'});

	test('a fresh browser cannot post yet, and is offered the way to fix it', async ({
		connectedPage,
		isDelegateRegistered,
		topUpState,
	}) => {
		const page = connectedPage;

		// Nothing has authorised this browser: it holds a key the account has
		// never heard of.
		expect(await isDelegateRegistered(page)).toBe(false);

		await page.getByPlaceholder('Enter your greeting...').fill('Hello there');
		await page.getByRole('button', {name: /send/i}).click();

		// The send is answered with the remedy, not with a revert.
		await expect(page.locator('[data-testid="payment-methods"]')).toBeVisible({
			timeout: 30_000,
		});
		expect((await topUpState(page)).registering).toBe(true);

		// Paying from the account is the primary offer: one transaction, one
		// prompt, no second connection.
		await expect(
			page.locator('[data-testid="pay-with-account"]'),
		).toBeEnabled();
	});

	test('registers directly when the account pays, and files the greeting under it', async ({
		connectedPage,
		authoriseBrowser,
		isDelegateRegistered,
	}) => {
		const page = connectedPage;
		const greeting = `Direct registration ${Date.now()}`;

		await page.getByPlaceholder('Enter your greeting...').fill(greeting);
		await page.getByRole('button', {name: /send/i}).click();

		const outcome = await authoriseBrowser(page, {
			via: 'account',
			// Check the question before answering it: it has to show the greeting
			// that was typed, several dialogs ago.
			resume: false,
		});
		expect(outcome.offered).toBe(true);
		await expect(
			page.locator('[data-testid="confirmation-detail"]'),
			'the interrupted greeting should be shown back, not described',
		).toHaveText(greeting);
		await page.locator('[data-testid="confirmation-confirm"]').click();
		// The owner is paying, so it sends `registerDelegate` itself: nothing is
		// signed, and nothing is explained because the wallet shows a transaction.
		expect(outcome.route).toBe('direct');
		expect(outcome.explained).toBe(false);
		// The send that ran into this is offered back rather than dropped, so the
		// greeting still goes out without the user asking a second time.
		expect(outcome.resumed).toBe(true);

		await expect
			.poll(async () => isDelegateRegistered(page), {timeout: 60_000})
			.toBe(true);

		const row = page
			.locator('[data-testid="message-row"]')
			.filter({hasText: greeting});
		await expect(row).toBeVisible({timeout: 60_000});
		await expect(row.locator('[data-testid="message-pending"]')).toHaveCount(
			0,
			{
				timeout: 60_000,
			},
		);

		// THE POINT OF THE WHOLE THING: the greeting is attributed to the account
		// the user signed in as, and not to the key this browser happens to hold.
		const account = await readStore(page, 'account');
		const signer = (await readStore(page, 'signerExecutor'))?.address;
		const filedUnder = await row.getAttribute('data-account');

		expect(filedUnder?.toLowerCase()).toBe(String(account).toLowerCase());
		expect(filedUnder?.toLowerCase()).not.toBe(String(signer).toLowerCase());
	});

	test('offers withdrawal in the account panel once the browser is authorised', async ({
		connectedPage,
		authoriseBrowser,
		isDelegateRegistered,
	}) => {
		const page = connectedPage;

		// Each test gets a fresh context and therefore a fresh account, so this one
		// has to authorise itself too. It declines the offer to resume: this test is
		// about the panel, not about the greeting.
		await page.getByPlaceholder('Enter your greeting...').fill('Hi');
		await page.getByRole('button', {name: /send/i}).click();
		await authoriseBrowser(page, {via: 'account', resume: false});
		await page.locator('[data-testid="confirmation-cancel"]').click();
		await expect
			.poll(async () => isDelegateRegistered(page), {timeout: 60_000})
			.toBe(true);

		// An authorisation the user cannot withdraw is the failure this whole
		// mechanism exists to avoid, so it is reachable from the panel.
		await page.getByRole('button', {name: 'Open menu'}).click();
		const row = page.locator('[data-testid="delegation-row"]');
		await expect(row).toBeVisible({timeout: 15_000});
		await expect(row).toHaveAttribute('data-authorised', 'true');
		await expect(
			page.locator('[data-testid="revoke-delegation"]'),
		).toBeEnabled();
	});
});

describe('Delegation - paying with another wallet', () => {
	describe.configure({mode: 'serial'});

	test('takes the signature route, and explains it before the wallet opens', async ({
		connectedPage,
		fundWalletAccounts,
		topUpState,
	}) => {
		const page = connectedPage;

		// Which account the payment picker lands on is not knowable in advance
		// (the burner generates them per browser context), so fund them all.
		await fundWalletAccounts(page);

		await page.getByPlaceholder('Enter your greeting...').fill('Hello there');
		await page.getByRole('button', {name: /send/i}).click();

		await expect(page.locator('[data-testid="payment-methods"]')).toBeVisible({
			timeout: 30_000,
		});
		await page.locator('[data-testid="pay-with-wallet"]').click();
		await connectPaymentWallet(page);

		// The payer is somebody else, so the owner's say-so has to travel in a
		// signature.
		const before = await topUpState(page);
		expect(before.route).toBe('live-signature');
		const account = await readStore(page, 'account');
		expect(before.payer?.toLowerCase()).not.toBe(String(account).toLowerCase());

		// The explanation is ON the confirm step, immediately above the button that
		// opens the wallet, so what appears there is not the first the user hears
		// of it. Signing in gets the same treatment.
		const consent = page.locator('[data-testid="delegation-consent"]');
		await expect(consent).toBeVisible({timeout: 15_000});
		await expect(consent).toContainText('act for your account');
		await expect(page.getByText('cannot move your funds')).toBeVisible();
		await expect(page.getByText('withdraw it later')).toBeVisible();

		// Read, and not yet acted on: the wallet has not been touched.
		expect((await topUpState(page)).phase).toBe('ready');
	});

	/**
	 * BLOCKED BY THE DEV WALLET, not by the app.
	 *
	 * The burner wallet's `personal_sign` (eip-1193-accounts-wrapper@0.1.1) does
	 * not implement EIP-191: it treats the hex-encoded data parameter as a
	 * literal string, and hand-prefixes "\x19Ethereum Signed Message:\n" before
	 * calling viem's `signMessage`, which prefixes it again. The signature it
	 * returns therefore recovers to a different address than the signer, so a
	 * contract verifying the message text - which is what `Delegation` does, and
	 * what every real wallet supports - can only reject it.
	 *
	 * Verified directly against that package: signing a message and recovering it
	 * with viem's `recoverMessageAddress` yields an unrelated address.
	 *
	 * The burner is the only wallet an e2e run has, so this half cannot be
	 * exercised here until that package is fixed or patched. Everything the app
	 * decides on this path IS covered: the route selection, the collapse onto the
	 * direct route, the pre-signed branch and the exact bytes submitted are in
	 * test/lib/ui/credits/top-up-flow.test.ts, and the message the owner signs is
	 * pinned against the contract in contracts/test/js/Delegation.test.ts.
	 */
	test.skip('completes the registration once the owner has signed', async () => {});
});
