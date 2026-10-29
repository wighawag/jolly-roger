import {describe, it, expect, vi} from 'vitest';
import {get} from 'svelte/store';
import {createAccountData} from '../../../src/lib/account/AccountData';
import type {AccountDataLifecycle} from '../../../src/lib/account/lifecycle';
import {
	ALICE,
	BOB,
	SCOPE,
	accountStore,
	clock,
	controlledStorage,
	deployments,
} from './account-data-harness';

/**
 * `lifecycle$` is what a consumer that must not act on data it has not got
 * (the commit-reveal submission, the HUD) derives from. Each status is held
 * here with a storage the test controls, so the readable is checked in the
 * state, not in a race past it.
 */

function setup(initial: `0x${string}` | undefined) {
	const storage = controlledStorage();
	const account = accountStore(initial);
	const accountData = createAccountData({
		accountStore: account,
		deployments,
		clock,
		scopeAddress: SCOPE,
		storageAdapter: storage.adapter,
	});
	const seen: AccountDataLifecycle[] = [];
	const stop = accountData.lifecycle$.subscribe((value) => seen.push(value));
	return {storage, account, accountData, seen, stop};
}

describe('the account data lifecycle', () => {
	it('is no-account while nothing is connected', () => {
		const {accountData, stop} = setup(undefined);
		try {
			expect(get(accountData.lifecycle$)).toEqual({status: 'no-account'});
		} finally {
			stop();
		}
	});

	it('is loading until the account data has loaded, then ready', async () => {
		const {storage, account, accountData, stop} = setup(undefined);
		storage.hold();
		try {
			account.set(ALICE);
			expect(get(accountData.lifecycle$)).toEqual({
				status: 'loading',
				account: ALICE,
			});
			expect(accountData.writer()).toBeUndefined();
			expect(accountData.read()).toBeUndefined();

			storage.release();
			await vi.waitFor(() =>
				expect(get(accountData.lifecycle$)).toEqual({
					status: 'ready',
					account: ALICE,
				}),
			);
			expect(accountData.writer()?.account).toBe(ALICE);
			expect(accountData.read()).toEqual({operations: {}});
		} finally {
			stop();
		}
	});

	it('goes back to loading on an account switch, then ready for the new account', async () => {
		const {storage, account, accountData, seen, stop} = setup(ALICE);
		try {
			await vi.waitFor(() =>
				expect(get(accountData.lifecycle$)).toEqual({
					status: 'ready',
					account: ALICE,
				}),
			);

			storage.hold();
			seen.length = 0;
			account.set(BOB);
			// Never ready for Alice's data once Bob is current, and never
			// "no account" in between: the switch is a load, not a disconnect.
			expect(seen).toEqual([{status: 'loading', account: BOB}]);

			storage.release();
			await vi.waitFor(() =>
				expect(get(accountData.lifecycle$)).toEqual({
					status: 'ready',
					account: BOB,
				}),
			);
			expect(seen.some((value) => value.status === 'no-account')).toBe(false);
			expect(accountData.writer()?.account).toBe(BOB);
		} finally {
			stop();
		}
	});

	it('is no-account again on a disconnect', async () => {
		const {account, accountData, stop} = setup(ALICE);
		try {
			await vi.waitFor(() =>
				expect(get(accountData.lifecycle$).status).toBe('ready'),
			);
			account.set(undefined);
			expect(get(accountData.lifecycle$)).toEqual({status: 'no-account'});
		} finally {
			stop();
		}
	});

	it('reports a load error with its error, and no write handle', async () => {
		const {storage, account, accountData, stop} = setup(undefined);
		const failure = new Error('storage is unreadable');
		storage.loadError = failure;
		try {
			account.set(ALICE);
			await vi.waitFor(() =>
				expect(get(accountData.lifecycle$)).toEqual({
					status: 'error',
					account: ALICE,
					error: failure,
				}),
			);
			expect(accountData.writer()).toBeUndefined();
			expect(accountData.read()).toBeUndefined();
			expect(accountData.isReady()).toBe(false);
		} finally {
			stop();
		}
	});

	it('is loading, not ready, while a load in flight is retried after an error', async () => {
		const {storage, account, accountData, stop} = setup(undefined);
		storage.loadError = new Error('storage is unreadable');
		try {
			account.set(ALICE);
			await vi.waitFor(() =>
				expect(get(accountData.lifecycle$).status).toBe('error'),
			);
			storage.loadError = undefined;
			storage.hold();
			accountData.get()!.retryLoad();
			expect(get(accountData.lifecycle$)).toEqual({
				status: 'loading',
				account: ALICE,
			});
			storage.release();
			await vi.waitFor(() =>
				expect(get(accountData.lifecycle$)).toEqual({
					status: 'ready',
					account: ALICE,
				}),
			);
		} finally {
			stop();
		}
	});
});
