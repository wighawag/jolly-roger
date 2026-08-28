import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';
import {
	approveHeldTransaction,
	executeButton,
	installStallingWallet,
	isHoldingTransaction,
	sendAndStall as stallARequest,
	sentHashes,
	writeForm,
} from '../fixtures/stalling-wallet';

/**
 * The escape hatch, driven through the window it exists for (ADR-0004, `work`).
 *
 * WHAT THIS CAUGHT. The first version of "Stop waiting" called
 * `connection.cancel()`, which sets the flow to Idle, clears the wallet and
 * calls `deleteLastWallet()`. The account went away, and account data with it.
 * The user then approved in their wallet, the transaction landed, and
 * `transaction:broadcasted` had nowhere to file it: the app showed "Transaction
 * error: accountData not ready" over a greeting that had in fact been posted,
 * and kept no record of the transaction at all. The feature built to stop the
 * app losing transactions was losing them.
 *
 * It is driven with a stalling wallet rather than the burner because the burner
 * answers instantly and is suppressed from the wallet-action prompt entirely, so
 * none of this is reachable with it. See e2e/fixtures/stalling-wallet.ts.
 *
 * DRIVEN THROUGH /contracts ON THIS BRANCH, not the demo page, and the reason is
 * the whole point of the branch. This app posts through a LOCAL SIGNER: the demo
 * page's Send never reaches the user's wallet, so a stalling wallet cannot stand
 * in that window because the window is not there. The account executor is what
 * still prompts, and `/contracts` calls it directly, which makes it the shortest
 * route to a wallet that has a transaction and is not answering. The behaviour
 * under test is the same code (`core/connection/wallet-activity.ts`), reached
 * the way THIS app reaches it.
 *
 * It also has to SIGN IN, which the template above does not: the flow stops at
 * WalletConnected until the user confirms, and the stalling wallet answers the
 * sign-in signature with a fixed fake one. Nothing verifies it locally (the
 * signature is entropy for deriving the signer), and using a real key here would
 * make this fixture able to authenticate as that account elsewhere.
 */
describe('Stopping waiting for the wallet', () => {
	// Sends transactions, from the stalling wallet's own account rather than a
	// burner one (see STALLING_WALLET_ACCOUNT), so it races nothing. Serial
	// anyway: `fullyParallel` applies to tests, and these share one account.
	describe.configure({mode: 'serial'});

	const nodeUrl =
		(globalThis as any).process.env.E2E_RPC_URL ||
		`http://127.0.0.1:${(globalThis as any).process.env.E2E_RPC_PORT || '8545'}`;

	// The connection flow's modals are SYSTEM overlays: their visibility is derived
	// from `$connection.step`, so they sit in the layer above ordinary modals.
	const dialog = (page: Page, hasText: string | RegExp) =>
		page.locator('#--layer-system [role="dialog"]', {hasText});

	/**
	 * Send, leave the wallet holding it, and check the app says so.
	 *
	 * The walk itself is `sendAndStall` in the fixture, shared with the sending
	 * indicator's suite, and on THIS branch it drives `/contracts` rather than the
	 * demo page: this app posts through a local signer, so the demo page's Send
	 * never reaches the user's wallet and a stalling wallet cannot stand in a
	 * window that is not there. The account executor still prompts, and
	 * `/contracts` calls it directly. That fact is stated once, in the fixture,
	 * because the sending-indicator suite needs exactly the same thing and got
	 * left behind when it was stated here instead.
	 *
	 * What stays here is the ASSERTION, which is this suite's subject rather than
	 * its setup: the modal is the thing that offers the escape hatch, so every
	 * test below starts from it being on screen.
	 */
	async function sendAndStall(page: Page, message: string) {
		await installStallingWallet(page, {nodeUrl});
		await stallARequest(page, {message});
		await expect(dialog(page, 'Wallet Action Required')).toBeVisible({
			timeout: 30_000,
		});
	}

	/** Take the escape hatch: the trigger, then the confirmation. */
	async function stopWaiting(page: Page) {
		await dialog(page, 'Wallet Action Required')
			.getByRole('button', {name: 'Stop waiting'})
			.click();
		const confirmation = dialog(page, 'Your wallet still has this transaction');
		await expect(confirmation).toBeVisible({timeout: 15_000});
		await confirmation.getByRole('button', {name: 'Stop waiting'}).click();
	}

	test('tells the truth, and never offers to cancel', async ({page}) => {
		await sendAndStall(page, 'escape hatch copy');

		await dialog(page, 'Wallet Action Required')
			.getByRole('button', {name: 'Stop waiting'})
			.click();

		const confirmation = dialog(page, 'Your wallet still has this transaction');
		await expect(confirmation).toBeVisible({timeout: 15_000});
		// The app cannot take back a request the wallet already has, so it must
		// not offer a control that implies it can.
		await expect(confirmation).toContainText('cannot take a request back');
		await expect(confirmation).toContainText('it will still be sent');
		await expect(
			confirmation.getByRole('button', {name: 'Keep waiting'}),
		).toBeVisible();
		await expect(
			confirmation.getByRole('button', {name: /^cancel$/i}),
		).toHaveCount(0);
	});

	test('releases the modal WITHOUT disconnecting the account', async ({
		page,
	}) => {
		await sendAndStall(page, 'stop waiting stays connected');
		await stopWaiting(page);

		// The blocking modal is gone, which is what the user asked for.
		await expect(dialog(page, 'Wallet Action Required')).toHaveCount(0);

		// And nothing else moved. Disconnecting here is what destroyed the app's
		// ability to record the transaction when it eventually landed.
		const state = await page.evaluate(() => ({
			step: (globalThis as any).get((globalThis as any).context.connection)
				.step,
			accountDataReady: (globalThis as any).context.accountData.isReady(),
		}));
		// SignedIn rather than WalletConnected: this app signs in, and the point is
		// that stopping waiting left the connection exactly where it was.
		expect(state.step).toBe('SignedIn');
		expect(state.accountDataReady).toBe(true);

		// It must not claim anything about a request it is still listening for.
		await expect(dialog(page, 'may have been sent')).toHaveCount(0);
	});

	test('releases the submit button, which the wallet may never answer', async ({
		page,
	}) => {
		// Reported from real use: the modal went, and the button stayed disabled and
		// spinning. The page was awaiting a promise that a wallet is under no
		// obligation to settle, so no amount of waiting would have fixed it.
		const message = 'submit button released';
		await sendAndStall(page, message);

		// The label, not the `disabled` attribute: this control stays clickable on
		// purpose (see ContractFunction.svelte) and reports being busy in words. What
		// the bug looked like was those words never going away, because the page was
		// awaiting a promise the wallet is under no obligation to settle.
		const execute = executeButton(page);
		await expect(execute).toHaveText(/executing/i);

		await stopWaiting(page);

		await expect(execute).toHaveText(/^execute$/i, {timeout: 15_000});
		// And what they typed is still there. They have not been told anything
		// happened, so taking their text away would be the app deciding it did.
		await expect(
			writeForm(page).getByPlaceholder('Enter text...').first(),
		).toHaveValue(message);
		// Released without withdrawing anything: the wallet still has the request.
		expect(await isHoldingTransaction(page)).toBe(true);
	});

	test('records the transaction when the user approves it later', async ({
		page,
	}) => {
		// The promise the escape hatch makes, kept: "if you approve it later, it
		// will still be sent". The app has to still be there to notice.
		const message = 'approved after stopping';
		await sendAndStall(page, message);
		await stopWaiting(page);

		await approveHeldTransaction(page);

		const [hash] = await expect
			.poll(() => sentHashes(page), {timeout: 30_000})
			.toHaveLength(1)
			.then(() => sentHashes(page));

		// Recorded as an operation, exactly as if nobody had stopped waiting.
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						Object.values(
							(globalThis as any).get(
								(globalThis as any).context.accountData.watchField(
									'operations',
								),
							),
						).map((op: any) => op.transactionIntent.transactions[0]?.hash),
					),
				{timeout: 30_000},
			)
			.toContain(hash);

		// No error about a transaction that succeeded, and nothing left in the
		// ledger to warn about.
		await expect(dialog(page, 'Transaction error')).toHaveCount(0);
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							(globalThis as any).get((globalThis as any).context.inFlight)
								.requests.length,
					),
				{timeout: 30_000},
			)
			.toBe(0);

		// And nothing is claimed about a transaction the app watched land.
		await expect(dialog(page, 'may have been sent')).toHaveCount(0);
	});
});
