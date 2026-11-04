import {test, expect} from '../fixtures/test';

// Its own account, which no other suite funds, so it starts EMPTY: see
// test/e2e-account-claims.test.ts.
test.use({walletAccountIndex: 4});

const FAUCET_URL = (globalThis as any).process.env.E2E_FAUCET_URL as
	string | undefined;

test.describe('A player with no ETH', () => {
	test.skip(!FAUCET_URL, 'no faucet: run through scripts/run-e2e-tests.sh');

	// How a player on a LAN box (or any chain with a faucet) starts: a fresh
	// burner, nothing in it, and "Get ETH" in the insufficient-funds dialog,
	// which claims from the faucet (PUBLIC_FAUCET_API) and carries on.
	test('gets ETH from the faucet, and their greeting goes out', async ({
		page,
		connectWallet,
		submitGreeting,
	}) => {
		test.setTimeout(180_000);
		const claims: string[] = [];
		page.on('request', (request) => {
			if (request.url().startsWith(FAUCET_URL!)) claims.push(request.url());
		});

		await page.goto('/demo');
		const connect = page.getByRole('button', {name: /^connect$/i}).first();
		await expect(connect).toBeEnabled({timeout: 60_000});
		await connect.click();
		await connectWallet(page, {fund: false});

		await submitGreeting(page, `from the faucet ${Date.now()}`);

		expect(claims, 'the faucet should have been asked for ETH').not.toEqual([]);
	});
});
