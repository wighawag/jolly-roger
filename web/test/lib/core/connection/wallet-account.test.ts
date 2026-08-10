import {describe, it, expect} from 'vitest';
import {
	walletAccountsNow,
	walletCanActAs,
	walletSelectedInstead,
} from '$lib/core/connection/wallet-account';

const A = '0x00000000000000000000000000000000000000aA' as const;
const B = '0x00000000000000000000000000000000000000bB' as const;

/**
 * The two wallet shapes, as they actually arrive.
 *
 * The library sets `accounts` to whatever `eth_accounts` returned and, when the
 * ACTIVE account moved, sets `accountChanged` alongside it on the same event.
 */
const metamask = (accounts: readonly `0x${string}`[], active?: `0x${string}`) =>
	({wallet: {accounts, accountChanged: active}}) as const;

describe('walletCanActAs: which wallets need an account switch', () => {
	it('lets MetaMask act as any connected account, whichever is active', () => {
		// eth_accounts returns every account the user connected, so switching the
		// active one changes nothing about what the wallet will sign or send.
		// Reading `accountChanged` as the whole list made MetaMask look like a
		// one-account wallet and demanded a switch that was never needed.
		const $connection = metamask([B, A], B);

		expect(walletCanActAs($connection, A)).toBe(true);
		expect(walletCanActAs($connection, B)).toBe(true);
		expect(walletSelectedInstead($connection, A)).toBeUndefined();
	});

	it('holds Rabby to the one account it exposes', () => {
		// eth_accounts returns exactly one address, so acting as any other one has
		// to wait for the user to switch in the wallet.
		const $connection = metamask([B], B);

		expect(walletCanActAs($connection, B)).toBe(true);
		expect(walletCanActAs($connection, A)).toBe(false);
		expect(walletSelectedInstead($connection, A)).toBe(B);
	});

	it('ignores address casing, which the chain does not care about', () => {
		const $connection = metamask([A.toLowerCase() as `0x${string}`]);
		expect(walletCanActAs($connection, A)).toBe(true);
	});

	it('says yes when there is no wallet to ask', () => {
		// Not a question about an account that has no wallet; answering no would
		// make every caller guard a case that is already handled elsewhere.
		expect(walletCanActAs({step: 'SignedIn'}, A)).toBe(true);
		expect(walletAccountsNow({step: 'SignedIn'})).toEqual([]);
	});

	it('says no when there is no address to act as', () => {
		expect(walletCanActAs(metamask([A]), undefined)).toBe(false);
	});
});
