import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';
import {
	approveHeldTransaction,
	executeButton,
	installStallingWallet,
	isHoldingTransaction,
	lockStallingWallet,
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
	 * The modal that says the wallet is holding a transaction.
	 *
	 * Matched on the transaction wording rather than the old fixed title "Wallet
	 * Action Required": since @etherplay/connect 0.10.0 a pending request carries
	 * what it is FOR and WHO is expected to answer it, so the modal names what is
	 * being asked (see `walletPromptCopy`). Named here once because it is this
	 * suite's entry point, not its subject.
	 */
	const waitingModal = (page: Page) =>
		dialog(page, 'Confirm the transaction in your wallet');

	const escapeHatch = (page: Page) =>
		waitingModal(page).getByRole('button', {name: 'Stop waiting'});

	/**
	 * The library's own count, read where it lives SINCE 0.11.0.
	 *
	 * `connection.pendingRequests`, not `connection.wallet.pendingRequests`. The
	 * mirror on the wallet is deprecated and, more to the point here, absent from
	 * exactly the states these tests drive into: a flow resting with no wallet
	 * while the user's wallet is still holding a prompt. Reading the mirror would
	 * make the assertion below pass for the wrong reason on one path and fail for
	 * the wrong reason on the other.
	 */
	const pendingRequestCount = (page: Page) =>
		page.evaluate(
			() =>
				((globalThis as any).get((globalThis as any).context.connection)
					.pendingRequests?.length ?? 0) as number,
		);

	const walletStatus = (page: Page) =>
		page.evaluate(
			() =>
				(globalThis as any).get((globalThis as any).context.connection).wallet
					?.status,
		);

	/**
	 * THE BROWSER'S ANSWER, NOT THE APP'S OPINION OF IT: a real cancelable
	 * `beforeunload`, through whatever listener is actually installed.
	 *
	 * Dispatched here rather than through the `appNavigation.simulateUnload()`
	 * debug handle, which does exactly this and is `import.meta.env.DEV` only, so
	 * it is absent from the production build the e2e suite runs and this read
	 * silently threw. Asking the browser directly needs no dev affordance and tests
	 * the same wiring: `navigation-driver` calls `preventDefault()` and sets
	 * `returnValue`, and only a registered guard returning true does that.
	 */
	const wouldBlockUnload = (page: Page) =>
		page.evaluate(() => {
			const event = new Event('beforeunload', {cancelable: true});
			window.dispatchEvent(event);
			return event.defaultPrevented;
		});

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
		await stallARequest(page, {input: message});
		await expect(waitingModal(page)).toBeVisible({
			timeout: 30_000,
		});
	}

	/** Take the escape hatch: the trigger, then the confirmation. */
	async function stopWaiting(page: Page) {
		await waitingModal(page)
			.getByRole('button', {name: 'Stop waiting'})
			.click();
		const confirmation = dialog(page, 'Your wallet still has this transaction');
		await expect(confirmation).toBeVisible({timeout: 15_000});
		await confirmation.getByRole('button', {name: 'Stop waiting'}).click();
	}

	test('tells the truth, and never offers to cancel', async ({page}) => {
		await sendAndStall(page, 'escape hatch copy');

		await waitingModal(page)
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
		// Captured rather than named, for the same reason as the locked test below:
		// which step a connected app rests on is its TARGET step, `WalletConnected`
		// in the template and `SignedIn` in a descendant that signs in. The claim
		// here is that stopping waiting moves NOTHING, and comparing against what it
		// was says that directly instead of encoding one app's answer.
		const stepBefore = await page.evaluate(
			() =>
				(globalThis as any).get((globalThis as any).context.connection).step,
		);
		await stopWaiting(page);

		// The blocking modal is gone, which is what the user asked for.
		await expect(waitingModal(page)).toHaveCount(0);

		// And nothing else moved. Disconnecting here is what destroyed the app's
		// ability to record the transaction when it eventually landed.
		const state = await page.evaluate(() => ({
			step: (globalThis as any).get((globalThis as any).context.connection)
				.step,
			accountDataReady: (globalThis as any).context.accountData.isReady(),
		}));
		expect(state.step).toBe(stepBefore);
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

	test('survives the reconnect that used to erase the request', async ({
		page,
	}) => {
		// THE BUG THIS SUITE COULD NOT SEE UNTIL NOW, driven end to end from the
		// consumer side.
		//
		// A send against a LOCKED wallet raises the connection flow, so `connect()`
		// runs while the wallet is still holding the transaction and rebuilds wallet
		// state underneath it. Every rebuild in @etherplay/connect used to assert
		// `pendingRequests: []`, which erased the outstanding request PERMANENTLY:
		// the list is only written on request events, and the next event for a
		// request is the one that ends it, so nothing ever put it back. A real
		// locked-Rabby session logged `pendingRequests: 0` with
		// `inFlight.dispatching: 1`
		// (work/notes/observations/wallet-action-required-modal-not-seen.md on
		// `work`). 0.10.0 copies the live list from the provider wrapper at every
		// rebuild instead.
		//
		// Asserted on BOTH layers on purpose. The three affordances staying up is
		// what the user experiences, but this app also keeps its own dispatch ledger,
		// which would hold all three up on its own and hide an upstream regression
		// completely. So the library's list is read directly too: that number is the
		// one that was 0.
		await sendAndStall(page, 'reconnect under a parked transaction');

		expect(await pendingRequestCount(page)).toBe(1);
		await expect(escapeHatch(page)).toBeVisible();
		expect(await wouldBlockUnload(page)).toBe(true);

		// The user locks their wallet. It is still holding the transaction, exactly
		// as a real one would be.
		await lockStallingWallet(page);
		await expect
			.poll(() => walletStatus(page), {timeout: 15_000})
			.toBe('locked');

		// And the flow is raised again, which IS the transition.
		//
		// `ensureConnected()`, not `connect()`, and the difference is deliberate on
		// both sides now. `ensureConnected` promises a TARGET, so it is the one that
		// reconnects a locked wallet by replaying the existing mechanism; `connect()`
		// drives the flow from the user's CHOICE and opens the picker. Upstream made
		// that asymmetry explicit in 0.11.0 rather than removing it, and the picker
		// path is covered by the next test. This is also the app's own send path: the
		// first thing `routes/demo/lib/setGreeting.ts` does is await this, so pressing
		// Send against a locked wallet runs exactly this line.
		await page.evaluate(() =>
			(globalThis as any).context.connection.ensureConnected(),
		);
		await expect
			.poll(() => walletStatus(page), {timeout: 30_000})
			.toBe('connected');

		// Nothing was withdrawn: the wallet still has it.
		expect(await isHoldingTransaction(page)).toBe(true);

		// FIRST, THE LIBRARY'S OWN ANSWER, because it is the one that regressed and
		// it fails with a readable number rather than "element not found". Pinning
		// @etherplay/connect back to 0.7.1 turns this into `expected 1, received 0`.
		// It is also the reason this test is not merely re-testing the app's ledger,
		// which would hold all three affordances below up on its own and hide an
		// upstream regression completely.
		expect(await pendingRequestCount(page)).toBe(1);

		// THEN ALL THREE STAY UP. Every one of them used to go silent here, which
		// left the user holding a wallet popup the app believed did not exist, with
		// no explanation, no exit, and no warning before a reload threw the answer
		// away.
		//
		// The modal is matched on the TRANSACTION wording, which makes this stricter
		// than "a modal is up": with the list erased, the app still blocks on the
		// strength of its own dispatch but says "Getting your transaction ready"
		// instead, because an empty list can no longer be read as a wallet request
		// (see `walletPromptCopy`). So this asserts the app is speaking for the
		// WALLET, which it may only do when the wallet really is holding something.
		await expect(waitingModal(page)).toBeVisible();
		await expect(escapeHatch(page)).toBeVisible();
		expect(await wouldBlockUnload(page)).toBe(true);

		// AND THEY STILL GO AWAY WHEN THE WALLET ANSWERS. A modal that never closes
		// is a worse bug than the one being fixed, and "copy the live list at every
		// rebuild" is exactly the shape of change that could strand one.
		await approveHeldTransaction(page);

		await expect(waitingModal(page)).toHaveCount(0, {timeout: 30_000});
		await expect
			.poll(() => pendingRequestCount(page), {timeout: 30_000})
			.toBe(0);
		await expect
			.poll(() => wouldBlockUnload(page), {timeout: 30_000})
			.toBe(false);

		// And it really landed, from the account it started under.
		await expect
			.poll(() => sentHashes(page), {timeout: 30_000})
			.toHaveLength(1);
	});

	test('keeps announcing a request through a state with NO wallet', async ({
		page,
	}) => {
		// THE SECOND HOLE, closed by @etherplay/connect 0.11.0, and the reason the
		// list no longer lives on the wallet object.
		//
		// 0.10.0's rule was "copy the live list at every `wallet: {...}` rebuild",
		// which does nothing for the paths that build NO wallet: a failed reconnect,
		// a mechanism picker, and this one. The list survived inside the provider
		// wrapper and there was simply nowhere left to read it from. 0.11.0 moved
		// `pendingRequests` up beside `wallet` and stamps it on every publish, so a
		// state with no wallet still reports what the user's wallet is holding.
		//
		// Driven through `connect()` on a locked wallet, which is NOT a bug and was
		// reported as one from here. It opens the wallet picker, because `connect`
		// means "the user wants to connect something" while `ensureConnected` promises
		// a target; the picker drops the wallet, which is its contract. That is
		// reachable in this app today, since the navbar's Connect button is
		// `connection.connect()`. What made it look destructive was this hole, not the
		// asymmetry: the teardown also erased the announcement. Now it costs a click.
		await sendAndStall(page, 'announced with no wallet in state');
		expect(await pendingRequestCount(page)).toBe(1);

		await lockStallingWallet(page);
		await expect
			.poll(() => walletStatus(page), {timeout: 15_000})
			.toBe('locked');

		await page.evaluate(() => (globalThis as any).context.connection.connect());

		// The flow comes to rest showing NO wallet at all. That is the state the
		// announcement used to disappear in, so it is asserted rather than assumed:
		// without it this test would silently become a second copy of the one above.
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const c = (globalThis as any).get(
							(globalThis as any).context.connection,
						);
						return {step: c.step, hasWallet: !!c.wallet};
					}),
				{timeout: 30_000},
			)
			.toEqual({step: 'WalletToChoose', hasWallet: false});

		// The wallet is still holding it, and the app can still say so.
		expect(await isHoldingTransaction(page)).toBe(true);
		expect(await pendingRequestCount(page)).toBe(1);
		await expect(waitingModal(page)).toBeVisible();
		await expect(escapeHatch(page)).toBeVisible();
		expect(await wouldBlockUnload(page)).toBe(true);

		// And it still clears when the wallet answers, from a state that never got
		// its wallet back.
		await approveHeldTransaction(page);
		await expect
			.poll(() => pendingRequestCount(page), {timeout: 30_000})
			.toBe(0);
		await expect(waitingModal(page)).toHaveCount(0, {timeout: 30_000});
		await expect
			.poll(() => sentHashes(page), {timeout: 30_000})
			.toHaveLength(1);
	});

	test('offers Unlock, and says so, when the wallet has gone to sleep', async ({
		page,
	}) => {
		// A LOCKED WALLET IS NOT SHOWING THE USER THE REQUEST, so telling them to
		// approve it there is a false instruction in the most literal way available.
		//
		// Measured before this existed, in exactly this state: the modal said
		// "Confirm the transaction in your wallet", the navbar showed `~10000 ETH`,
		// and the only buttons on the page were Send and Stop waiting. Locking keeps
		// `step: 'WalletConnected'`, so every `isTargetStepReached` branch rendered a
		// wallet that was refusing everything as a working one, and the app's only
		// suggestion was to give up.
		await sendAndStall(page, 'locked while holding it');
		// Captured rather than named. The claim is that `unlock()` KEEPS the step
		// where re-running the flow would rebuild it, and which step that is depends
		// on the app's target (`WalletConnected` here, `SignedIn` in a descendant
		// that signs in). Hard-coding it made this fail in a sibling for a reason
		// that had nothing to do with locking.
		const stepBeforeLock = await page.evaluate(
			() =>
				(globalThis as any).get((globalThis as any).context.connection).step,
		);
		await lockStallingWallet(page);

		// The words change, and they change to the truth.
		const lockedModal = dialog(page, 'Your wallet is locked');
		await expect(lockedModal).toBeVisible({timeout: 15_000});
		await expect(lockedModal).toContainText('still there waiting');
		// It must NOT still be telling them to go and approve it.
		await expect(waitingModal(page)).toHaveCount(0);

		// The remedy is on screen, where the user is stuck.
		await expect(
			lockedModal.getByRole('button', {name: 'Unlock'}),
		).toBeVisible();

		// AND NOWHERE ELSE, which is the decision rather than an omission. A wallet
		// prompts for its password ON DEMAND, so chrome that sprouts an Unlock button
		// whenever a wallet auto-locks on a timer is noise about a state that resolves
		// itself the next time anything needs signing. The bar keeps showing the
		// account, which is still connected and whose balance is read through the
		// always-on provider rather than the wallet: only signing is asleep.
		//
		// Asserted because the opposite was built first and looked reasonable. Without
		// this, the next reader finds `walletLockState` used only by the modal and
		// helpfully wires it up here too.
		//
		// Asserted on `data-connected` and the ABSENCE of the button, rather than on
		// whatever the bar happens to render. A descendant showed `Needs funds` there
		// instead of a balance and failed this on a presentation detail that has
		// nothing to do with the decision being pinned. What every app in this tree
		// agrees on is that a locked wallet still reads as connected here and grows no
		// remedy of its own.
		const bar = page.getByTestId('wallet-status');
		await expect(bar.getByRole('button', {name: 'Unlock'})).toHaveCount(0);
		await expect(bar).toHaveAttribute('data-connected', 'true');

		// Nothing was withdrawn while the wallet slept, which is the promise the
		// copy makes: the request is still announced and still guarded.
		expect(await pendingRequestCount(page)).toBe(1);
		expect(await isHoldingTransaction(page)).toBe(true);
		expect(await wouldBlockUnload(page)).toBe(true);
		await expect(escapeHatch(page)).toHaveCount(0);
		await expect(
			lockedModal.getByRole('button', {name: 'Stop waiting'}),
		).toBeVisible();

		// And it WORKS, rather than merely being present. `unlock()` keeps the step,
		// the account and the wallet, where `connect()` would open the picker and
		// rebuild all three.
		await lockedModal.getByRole('button', {name: 'Unlock'}).click();
		await expect
			.poll(() => walletStatus(page), {timeout: 30_000})
			.toBe('connected');
		await expect(waitingModal(page)).toBeVisible({timeout: 15_000});
		expect(await pendingRequestCount(page)).toBe(1);

		// The account survived the round trip, which is the point of using unlock.
		expect(
			await page.evaluate(
				() =>
					(globalThis as any).get((globalThis as any).context.connection).step,
			),
		).toBe(stepBeforeLock);

		await approveHeldTransaction(page);
		await expect
			.poll(() => sentHashes(page), {timeout: 30_000})
			.toHaveLength(1);
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
						).map((op: any) => op.attempts[0]?.hash),
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
