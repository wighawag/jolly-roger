import {test, expect, describe} from '../fixtures/test';
import {
	approveHeldTransaction,
	installStallingWallet,
	sendAndStall,
} from '../fixtures/stalling-wallet';

/**
 * The two rungs that explain the browser's unload prompt, driven through the
 * only window they live in.
 *
 * WHY THIS NEEDS THE STALLING WALLET. Both surfaces exist between dispatching a
 * transaction and hearing back, and the burner answers that in milliseconds, so
 * with the burner there is nothing to stand in. This fixture parks the request
 * until the test releases it, which is also the shape of the case the delayed
 * rung is FOR: a wallet that is thinking.
 *
 * WHAT WOULD OTHERWISE ROT. The design rests on one property that no unit test
 * can see, because it is about what is on the page: the wordless pulse is up
 * IMMEDIATELY (a `beforeunload` dialog freezes the renderer, so anything painted
 * later is never painted at all), and the sentence waits, so a routine send is
 * silent. Timings are asserted as an ORDER and a floor rather than a window: a
 * loaded CI box can be slow, and a test that fails then would be measuring the
 * machine rather than the app.
 */
describe('Explaining a dispatch in flight', () => {
	// Serial within the file, and on its OWN stalling account (index 1, claimed
	// below and checked by test/e2e-account-claims.test.ts), so it races neither
	// itself nor the escape-hatch suite for a nonce.
	describe.configure({mode: 'serial'});

	const nodeUrl =
		(globalThis as any).process.env.E2E_RPC_URL ||
		`http://127.0.0.1:${(globalThis as any).process.env.E2E_RPC_PORT || '8545'}`;

	const PULSE = '[data-testid="sending-transaction"]';
	const NOTICE = '[data-testid="sending-notice"]';

	test('pulses at once, and only explains itself once it drags', async ({
		page,
	}) => {
		await installStallingWallet(page, {nodeUrl, stallingAccountIndex: 1});
		// The walk to a wallet that is holding something, shared with the escape
		// hatch's suite and overridden as one piece by a descendant whose sends do
		// not reach a wallet. This suite used to open-code it and was left behind
		// when the other copy was adapted, which is what the fixture now prevents.
		await sendAndStall(page, {message: 'sending indicator'});
		const dispatchedAt = Date.now();

		// The wordless rung: no delay, because this is the one that has to be on
		// screen when the browser asks.
		await expect(page.locator(PULSE)).toBeVisible({timeout: 10_000});
		const pulseAt = Date.now();

		// The words: only after the dispatch has gone on long enough to be worth
		// them. Waiting for it to appear (rather than asserting it is absent now)
		// keeps this from depending on how fast the assertion above ran.
		await expect(page.locator(NOTICE)).toBeVisible({timeout: 30_000});
		const noticeAt = Date.now();

		expect(
			pulseAt,
			'the pulse must not wait for the notice',
		).toBeLessThanOrEqual(noticeAt);
		expect(
			noticeAt - dispatchedAt,
			'the notice must not appear before its delay has elapsed',
		).toBeGreaterThanOrEqual(1_000);

		// It says what is being sent, in the words the transaction list uses, and
		// what leaving would cost. That sentence is the whole reason it exists.
		await expect(page.locator(NOTICE)).toContainText('setMessage');
		await expect(page.locator(NOTICE)).toContainText('Leaving the page now');

		// Above the wallet-action modal rather than under its backdrop: being
		// dimmed exactly while a modal holds the user is what put it in the top
		// layer (core/ui/layers.ts).
		const layer = await page
			.locator(NOTICE)
			.evaluate((node) =>
				node.closest('[data-layer]')?.getAttribute('data-layer'),
			);
		expect(layer).toBe('progress');

		// And both go when the answer arrives.
		await approveHeldTransaction(page);
		await expect(page.locator(NOTICE)).toHaveCount(0, {timeout: 30_000});
		await expect(page.locator(PULSE)).toHaveCount(0, {timeout: 30_000});
	});
});
