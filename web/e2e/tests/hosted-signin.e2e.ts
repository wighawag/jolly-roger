import {
	test,
	expect,
	describe,
	connectPaymentWallet,
	fundAddressViaHardhat,
} from '../fixtures/test';
import type {Page} from '@playwright/test';

/**
 * THE HALF OF DELEGATION NOTHING HAS EVER DRIVEN END TO END.
 *
 * `delegation.e2e.ts` covers what a WALLET owner does: it can be asked to sign
 * again at any moment, so its failures are recoverable and visible. This file
 * covers the other one. A hosted account mints its credential ONCE, at sign-in,
 * at a moment the user cannot return to, and every way that can go wrong is
 * silent: a credential for the wrong pair, a deadline that does not match, an
 * approval that was reported but not honoured. None of them throws. They
 * produce a signature that recovers a different address, or a result the app
 * never receives.
 *
 * It could not be tested here before because it needed a deployed wallet host.
 * It now needs a dependency: `@etherplay/dev-wallet-host`, started by
 * `scripts/run-e2e-tests.sh` on the origin the build is pinned to, and by
 * `pnpm web:wallet-host` in a dev session. Signing in against it needs no key,
 * no account and no network: the phrase is the standard hardhat one, so the
 * accounts it derives are the accounts this run already funded.
 */

const MNEMONIC = 'test test test test test test test test test test test junk';

/** `data-testid` of the panel the flow parks on when nothing can prove the authorisation. */
const RE_AUTHORISE = '[data-testid="re-authorise"]';

/**
 * The other way the payment step can settle here: on a payer with nothing in it.
 *
 * The burner generates its accounts per browser context, so the account that
 * ends up paying does not exist until it has been connected, and cannot be
 * funded before that. This is what the flow shows when it reads a payer that
 * has not been funded yet, and the recovery is the one a user takes when money
 * arrives late: look again.
 */
const EMPTY_PAYER = 'text=The account you chose to pay from is empty';

/** The account the app is signed in as, read from its own stores. */
async function readStore(page: Page, name: string) {
	return page.evaluate((storeName) => {
		const read = (store: any) => {
			let value: any;
			store.subscribe((v: any) => (value = v))();
			return value;
		};
		return read((globalThis as any).context[storeName]);
	}, name);
}

/**
 * Sign in through the HOST, the way a user does: a popup, an account, and an
 * answer to what the app asked for.
 *
 * Driven through `context.connection` rather than through the app's own Dev
 * Mode button, which a production bundle does not render, and this suite tests
 * the production bundle. The connect promise is deliberately not awaited inside
 * the page: it does not settle until the popup has been dealt with, which is
 * what happens next, out here.
 */
async function signInByMnemonic(
	page: Page,
	options: {index: number; permission: 'grant' | 'deny'},
): Promise<void> {
	// The app has to have HYDRATED before there is anything to drive: this suite
	// serves a static build, so the HTML arrives before the code that makes
	// `context` exist. Waiting on a rendered element would not be the same
	// promise, since the prerendered markup contains those elements already.
	await expect
		.poll(
			async () =>
				page.evaluate(() => !!(globalThis as any).context?.connection),
			{timeout: 30_000},
		)
		.toBe(true);

	const popupOpening = page.waitForEvent('popup');

	await page.evaluate((mnemonic) => {
		const connection = (globalThis as any).context.connection;
		// Caught in the page: a rejection here (a denied REQUIRED permission, a
		// closed popup) is an outcome this helper's caller asserts on through the
		// app's own state, not an unhandled rejection that fails the run.
		connection
			.connect({type: 'mnemonic', mnemonic, index: undefined})
			.catch(() => {});
	}, MNEMONIC);

	const popup = await popupOpening;

	// The host says why it cannot deliver, in ITS console, and that console is not
	// this test's. Forwarded so the one failure with no other symptom (an origin
	// mismatch: a sign-in that completes in the popup and reaches nobody) arrives
	// in the report instead of being invisible.
	popup.on('console', (message) => {
		const text = message.text();
		// The host looks for an optional configuration document and this run does
		// not have one, so the browser logs a 404 that means "no document", which
		// is the normal case. Forwarding it would train people to ignore this line.
		if (/Failed to load resource/.test(text)) return;
		if (message.type() === 'error' || message.type() === 'warning') {
			console.log(`[wallet host] ${text}`);
		}
	});

	// The account picker. Nine ids, so a test can pick one nobody else is using.
	await popup.locator(`#account-${options.index}`).click();

	// WHAT THE APP ASKED FOR, answered here. The app declares its delegation
	// permission as OPTIONAL, so both answers complete a sign-in and the
	// difference shows up later, as which route the top-up flow can take.
	const answer =
		options.permission === 'grant' ? '#permission-allow' : '#permission-deny';
	await popup.locator(answer).click({timeout: 15_000});

	// The popup closes itself once it has delivered. POLLED, not awaited as an
	// event: granting is the last thing it needs, so it can be gone before a
	// `waitForEvent('close')` registered after the click ever sees the event, and
	// the symptom of that race is a twenty-second timeout on a sign-in that
	// actually succeeded.
	//
	// Waiting for the popup rather than only for app state means a result posted
	// into the void (the origin mismatch this host warns about) still fails here,
	// at the step that caused it.
	await expect.poll(() => popup.isClosed(), {timeout: 20_000}).toBe(true);

	await expect
		.poll(async () => (await readStore(page, 'connection'))?.step, {
			timeout: 30_000,
		})
		.toBe('SignedIn');
}

describe('Hosted sign-in - the credential minted at the host', () => {
	// One account each, and serial, for the same reason the other delegation
	// suite is: these write to one shared registry on one chain.
	describe.configure({mode: 'serial'});

	test('mints a credential the pre-signed route submits, and the greeting is filed under the account', async ({
		page,
		isDelegateRegistered,
		topUpState,
	}) => {
		// The payer will be a wallet account, not the account signed in, which is
		// the whole shape of this route: somebody else pays, and the credential
		// proves an authorisation nobody here can sign for live.
		await page.goto('/demo');

		await signInByMnemonic(page, {index: 3, permission: 'grant'});

		// Hardhat account 3, derived in the popup from a phrase, with no service
		// behind it. Pinned because the whole point is that the app receives the
		// account the user chose and not another one.
		const account = String(await readStore(page, 'account')).toLowerCase();
		expect(account).toBe('0x90f79bf6eb2c4f870365e785982e1f101e93b906');

		// Nothing has authorised this browser yet: a credential is a signature the
		// account made, and registering it is still a transaction somebody sends.
		expect(await isDelegateRegistered(page)).toBe(false);

		const greeting = `Hosted account ${Date.now()}`;
		await page.getByPlaceholder('Enter your greeting...').fill(greeting);
		await page.getByRole('button', {name: /send/i}).click();

		await expect(page.locator('[data-testid="payment-methods"]')).toBeVisible({
			timeout: 30_000,
		});

		// A hosted account holds its key at the host and cannot send, so paying
		// from it is offered as unavailable rather than hidden.
		await expect(
			page.locator('[data-testid="pay-with-account"]'),
		).toBeDisabled();
		await page.locator('[data-testid="pay-with-wallet"]').click();
		await connectPaymentWallet(page, 1, [EMPTY_PAYER]);

		// Fund whoever the picker landed on, then ask the flow to look again. Doing
		// it in this order is forced rather than chosen: the payer is generated by
		// connecting, so there is no address to fund until this point.
		const payer = (await topUpState(page)).payer;
		expect(
			payer,
			'the payment connection should have produced a payer',
		).toBeTruthy();
		await fundAddressViaHardhat(payer as string, '100');
		await page.evaluate(() => (globalThis as any).context.topUp.refresh());
		await expect(page.locator('[data-testid="confirm-top-up"]')).toBeVisible({
			timeout: 30_000,
		});

		// THE ASSERTION THIS FILE EXISTS FOR. `pre-signed` is only reachable when
		// the connection is holding a usable credential for THIS (chainId,
		// contract), which it can only be holding because the popup minted it at
		// sign-in and delivered it. `live-signature` would mean the app fell back
		// to asking a wallet, and there is no wallet here to ask.
		expect((await topUpState(page)).route).toBe('pre-signed');
		await expect(
			page.getByText('already authorised this browser when you signed in'),
		).toBeVisible();

		await page.locator('[data-testid="confirm-top-up"]').click();

		// The flow closes only once the registration is IN a block: the whole point
		// is that nothing can be sent until it is.
		await expect(page.locator('[data-testid="confirm-top-up"]')).toHaveCount(
			0,
			{
				timeout: 90_000,
			},
		);

		// And the contract accepted it. This is the strongest thing this suite can
		// say and the one that was never said before: the signature minted in a
		// popup, weeks-long deadline and all, recovers the account that authorised
		// it, at the contract it named, on this chain.
		await expect
			.poll(async () => isDelegateRegistered(page), {timeout: 90_000})
			.toBe(true);

		// The send that ran into the authorisation is offered back, named, rather
		// than dropped: the greeting goes out without being typed a second time.
		const resume = page.locator('[data-testid="confirmation-confirm"]');
		await expect(resume).toBeVisible({timeout: 30_000});
		await expect(
			page.locator('[data-testid="confirmation-detail"]'),
			'the interrupted greeting should be shown back, not described',
		).toHaveText(greeting);
		await resume.click();

		const row = page
			.locator('[data-testid="message-row"]')
			.filter({hasText: greeting});
		await expect(row).toBeVisible({timeout: 90_000});
		await expect(row.locator('[data-testid="message-pending"]')).toHaveCount(
			0,
			{
				timeout: 90_000,
			},
		);

		// Filed under the ACCOUNT, not under the key this browser holds.
		const signer = (await readStore(page, 'signerExecutor'))?.address;
		const filedUnder = await row.getAttribute('data-account');
		expect(filedUnder?.toLowerCase()).toBe(account);
		expect(filedUnder?.toLowerCase()).not.toBe(String(signer).toLowerCase());
	});

	test('a denied permission still signs in, and lands on re-authorise when the authority is needed', async ({
		page,
		topUpState,
	}) => {
		// No funding anywhere in this one, and that is the point: the flow parks on
		// the missing authorisation BEFORE it ever looks at what the payer holds.
		await page.goto('/demo');

		// DENIED, and the sign-in still completes: the app declares this permission
		// optional on purpose, so a refusal leaves the app browsable rather than
		// being a wall at the door for something the user cannot evaluate yet.
		await signInByMnemonic(page, {index: 4, permission: 'deny'});

		const account = String(await readStore(page, 'account')).toLowerCase();
		expect(account).toBe('0x15d34aaf54267db7d7c367839aaf71a00a2c6a65');

		await page.getByPlaceholder('Enter your greeting...').fill('No authority');
		await page.getByRole('button', {name: /send/i}).click();

		await expect(page.locator('[data-testid="payment-methods"]')).toBeVisible({
			timeout: 30_000,
		});
		await page.locator('[data-testid="pay-with-wallet"]').click();
		await connectPaymentWallet(page, 1, [RE_AUTHORISE]);

		// The remedy, not a revert and not a spinner: there is no credential, and a
		// hosted account cannot produce one on demand, so the only way to get one
		// is to sign in again, which is what this panel says.
		await expect(page.locator(RE_AUTHORISE)).toBeVisible({timeout: 30_000});
		expect((await topUpState(page)).route).toBe('re-authorise');

		// And it warns, before the button, that the remedy signs the user out
		// first: an abandoned sign-in leaves them worse off than they started.
		await expect(page.getByText('This signs you out first')).toBeVisible();
		await expect(
			page.locator('[data-testid="re-authorise-confirm"]'),
		).toBeEnabled();
	});
});
