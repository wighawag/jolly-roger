import {test, expect, describe} from '../fixtures/test';

/**
 * `with/indexer`: the greetings' indexer, end to end. A greeting is posted
 * through the app, the indexer worker folds GreetingsRegistry's
 * `MessageChanged` in the browser, and the row shows how many greetings its
 * account has sent (`data-testid="greeting-count"`), beside the direct read.
 *
 * ITS OWN ACCOUNT (index 5): a suite that sends needs one, or it races
 * another for the nonce (`test/e2e-account-claims.test.ts`). Not 3 or 4, which
 * `with/local-signer`'s suites claim, so `with/push-notifications`, which stems
 * from both, inherits no collision. The count is still compared before and
 * after rather than named, so a re-run against the same chain passes too.
 */
test.use({walletAccountIndex: 5});

describe('Demo Page - greeting counts from the indexer', () => {
	describe.configure({mode: 'serial'});

	test('a greeting is counted, and the next one raises the count', async ({
		connectedPage,
		submitGreeting,
	}) => {
		const page = connectedPage;
		const stamp = Date.now();
		const first = `Counted ${stamp}`;
		const second = `Counted again ${stamp}`;

		async function countOn(message: string): Promise<number> {
			const badge = page
				.locator('[data-testid="message-row"]')
				.filter({hasText: message})
				.getByTestId('greeting-count');
			await expect(badge).toHaveText(/^\s*\d+\s*$/, {timeout: 60_000});
			return Number((await badge.textContent())?.trim());
		}

		await submitGreeting(page, first);
		const before = await countOn(first);
		expect(before).toBeGreaterThanOrEqual(1);

		await submitGreeting(page, second);
		const row = page
			.locator('[data-testid="message-row"]')
			.filter({hasText: second})
			.getByTestId('greeting-count');
		await expect
			.poll(async () => Number((await row.textContent())?.trim() ?? 0), {
				timeout: 60_000,
			})
			.toBeGreaterThan(before);
	});
});
