import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';

/**
 * In-flight transaction safety, driven end to end (ADR-0004, `work` branch).
 *
 * THE FAILURE THIS COVERS cannot be produced by clicking: it is the gap between
 * dispatching `eth_sendTransaction` and receiving the hash, and the interesting
 * case is the session that never got to the second half. So the test does what
 * a killed tab leaves behind, which is a record in storage, and then reloads.
 * That exercises exactly the path a crash takes: restore from storage,
 * reconcile against the node by nonce, and say something true about it.
 *
 * Deliberately no wallet. A record belongs to a chain and names its own account,
 * so it has to survive being found by a session that is not signed in as anyone,
 * and driving it this way also means a failure here is the mechanism rather than
 * a drifted wallet fixture.
 */
describe('In-flight transaction requests', () => {
	/** An address that has never sent anything, so the node's nonce is 0. */
	const NEVER_SENT = '0x00000000000000000000000000000000000000e2';
	/** Hardhat's first account: it deployed the contracts, so its nonce is past 0. */
	const HAS_SENT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

	/**
	 * How long to wait for the notice to appear.
	 *
	 * A seeded record is only REPORTED once it has been reconciled, and
	 * reconciliation reads the account's nonce from the node, so this waits on
	 * one round trip. 15s is many multiples of what that costs (~10ms locally).
	 *
	 * It was briefly 30s, to get a descendant's suite green. That was treating a
	 * symptom: the reads were UNBOUNDED, so a stalled endpoint left the pass
	 * outstanding for ever and no timeout here was ever going to be enough. The
	 * ledger now bounds them (see reconcileOnce) and gives up with `unreadable`
	 * instead, so the pass always completes and this can go back to being a
	 * generous margin on a fast operation.
	 */
	const NOTICE_TIMEOUT = 15000;

	const noticeOf = (page: Page) =>
		page.locator('#--layer-system [role="dialog"]', {
			hasText: 'may have been sent',
		});

	/**
	 * Leave a record behind the way an interrupted session would.
	 *
	 * The chain id comes from the running app rather than from a constant here:
	 * records are scoped per chain, and a test that hardcoded the wrong one would
	 * pass by finding nothing.
	 */
	async function seedRecord(
		page: Page,
		record: {account: string; nonce: number; description: string},
	) {
		// The context is built during app init and published for the console; wait
		// for it rather than assume hydration has run, which is the same lesson the
		// overlay driver learned (see KitNavigation.svelte).
		await page.waitForFunction(() => !!(globalThis as any).context, undefined, {
			timeout: 30000,
		});
		await page.evaluate((seed) => {
			const {id: chainId, genesisHash} = (
				globalThis as any
			).context.deployments.get().chain;
			localStorage.setItem(
				`__in_flight_requests__${chainId}_${genesisHash}`,
				JSON.stringify([
					{
						id: 'seeded-request',
						account: seed.account,
						chainId,
						nonce: seed.nonce,
						intent: {description: seed.description},
						requestedAt: Date.now(),
					},
				]),
			);
		}, record);
	}

	test('says a request may still be with the wallet, and never that it failed', async ({
		page,
	}) => {
		await page.goto('/');
		await seedRecord(page, {
			account: NEVER_SENT,
			nonce: 0,
			description: 'setMessage',
		});
		await page.reload();

		const notice = noticeOf(page);
		await expect(notice).toBeVisible({timeout: NOTICE_TIMEOUT});
		// It names the request the way the transaction list would.
		await expect(notice).toContainText('setMessage');
		// Nothing has landed from that account, so the only true thing to say is
		// that the wallet may still hold it. Approving it later would still send.
		await expect(notice).toContainText('still be waiting in your wallet');
		await expect(notice).toContainText('Approving it later');
		// The app did not observe a rejection, so it must not report one.
		await expect(notice).not.toContainText('rejected');
		await expect(notice).not.toContainText('failed');
	});

	test('says a transaction most likely landed when the nonce was consumed', async ({
		page,
	}) => {
		await page.goto('/');
		// Nonce 0 for an account that has since sent transactions: the slot this
		// request would have used is gone, so something went out.
		await seedRecord(page, {
			account: HAS_SENT,
			nonce: 0,
			description: 'setMessage',
		});
		await page.reload();

		const notice = noticeOf(page);
		await expect(notice).toBeVisible({timeout: NOTICE_TIMEOUT});
		await expect(notice).toContainText('most likely sent');
		// Still hedged: a nonce says a transaction landed, never which one.
		await expect(notice).toContainText('Check your transaction list');
	});

	test('stays acknowledged across a reload', async ({page}) => {
		await page.goto('/');
		await seedRecord(page, {
			account: NEVER_SENT,
			nonce: 0,
			description: 'setMessage',
		});
		await page.reload();

		const notice = noticeOf(page);
		await expect(notice).toBeVisible({timeout: NOTICE_TIMEOUT});
		await notice.getByRole('button', {name: 'Got it'}).click();
		await expect(notice).toHaveCount(0);

		// Acknowledging has to remove the RECORD, not just the dialog: a notice
		// that came back on every reload would train the user to ignore it.
		await page.reload();
		await expect(noticeOf(page)).toHaveCount(0);
		expect(
			await page.evaluate(() => {
				const {id: chainId, genesisHash} = (
					globalThis as any
				).context.deployments.get().chain;
				return localStorage.getItem(
					`__in_flight_requests__${chainId}_${genesisHash}`,
				);
			}),
		).toBeNull();
	});

	test('says nothing at all when there is nothing to say', async ({page}) => {
		// Guards the guard: without this, every assertion above could be passing
		// against a dialog that is simply always there.
		await page.goto('/');
		await expect(noticeOf(page)).toHaveCount(0);
	});
});
