import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {createAccountData} from '../../../../src/lib/account/AccountData';
import type {OverlayState} from '../../../../src/lib/core/ui/overlay';
import {watchOverlayOperation} from '../../../../src/lib/ui/pending-operation/overlays';
import {
	ALICE,
	BOB,
	SCOPE,
	accountStore,
	clock,
	controlledStorage,
	deployments,
	trackedTransaction,
} from '../../account/account-data-harness';

/**
 * What the operation inspector says it is showing, against a real account data
 * whose storage the test controls: in particular that a FAILED load is said as
 * such, rather than as a load that never ends.
 */

function setup() {
	const storage = controlledStorage();
	const account = accountStore(undefined);
	const accountData = createAccountData({
		accountStore: account,
		deployments,
		clock,
		scopeAddress: SCOPE,
		storageAdapter: storage.adapter,
	});
	const overlay = writable<OverlayState<string>>({open: false});
	const inspected = watchOverlayOperation(overlay, accountData);
	const stop = inspected.subscribe(() => {});
	return {storage, account, accountData, overlay, inspected, stop};
}

describe('the inspected operation', () => {
	it('is loading while the account data loads, then missing for an unknown key', async () => {
		const {storage, account, overlay, inspected, stop} = setup();
		storage.hold();
		try {
			account.set(ALICE);
			overlay.set({open: true, payload: '42'});
			expect(get(inspected)).toEqual({status: 'loading', key: '42'});
			storage.release();
			await vi.waitFor(() =>
				expect(get(inspected)).toEqual({status: 'missing', key: '42'}),
			);
		} finally {
			stop();
		}
	});

	it('is unavailable, with the error, when the account data failed to load', async () => {
		const {storage, account, overlay, inspected, stop} = setup();
		const failure = new Error('storage is unreadable');
		storage.loadError = failure;
		try {
			overlay.set({open: true, payload: '42'});
			account.set(ALICE);
			await vi.waitFor(() =>
				expect(get(inspected)).toEqual({
					status: 'unavailable',
					key: '42',
					error: failure,
				}),
			);
		} finally {
			stop();
		}
	});

	it('leaves unavailable for loading, then found, on a retry that succeeds', async () => {
		const {storage, account, accountData, overlay, inspected, stop} = setup();
		storage.loadError = new Error('storage is unreadable');
		try {
			account.set(ALICE);
			overlay.set({open: true, payload: '1000'});
			await vi.waitFor(() => expect(get(inspected).status).toBe('unavailable'));

			storage.loadError = undefined;
			storage.hold();
			accountData.get()!.retryLoad();
			expect(get(inspected)).toEqual({status: 'loading', key: '1000'});

			storage.release();
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));
			// clock.now() is 1000, so the first operation filed gets that id.
			accountData.addOperationFromTrackedTransaction(
				trackedTransaction(ALICE, 1),
			);
			expect(get(inspected).status).toBe('found');
		} finally {
			stop();
		}
	});
	it('is no-account while nothing is connected, then loading once an account is', async () => {
		const {storage, account, overlay, inspected, stop} = setup();
		storage.hold();
		try {
			overlay.set({open: true, payload: '42'});
			expect(get(inspected)).toEqual({status: 'no-account', key: '42'});
			account.set(ALICE);
			expect(get(inspected)).toEqual({status: 'loading', key: '42'});
			storage.release();
			await vi.waitFor(() =>
				expect(get(inspected)).toEqual({status: 'missing', key: '42'}),
			);
		} finally {
			stop();
		}
	});

	async function foundOperation() {
		const s = setup();
		// Open first: the inspector's subscription is what starts the store.
		s.overlay.set({open: true, payload: '1000'});
		s.account.set(ALICE);
		await vi.waitFor(() => expect(s.accountData.isReady()).toBe(true));
		// clock.now() is 1000, so the first operation filed gets that id.
		s.accountData.addOperationFromTrackedTransaction(
			trackedTransaction(ALICE, 1),
		);
		expect(get(s.inspected).status).toBe('found');
		return s;
	}

	it('is cleared when the operation is removed from the same account', async () => {
		const {accountData, inspected, stop} = await foundOperation();
		try {
			accountData.writer()!.removeItem('operations', '1000');
			expect(get(inspected)).toEqual({status: 'cleared', key: '1000'});
		} finally {
			stop();
		}
	});

	it('is no-account, not cleared, on a disconnect after it was found', async () => {
		const {account, inspected, stop} = await foundOperation();
		try {
			account.set(undefined);
			expect(get(inspected)).toEqual({status: 'no-account', key: '1000'});
		} finally {
			stop();
		}
	});

	it('looks in the new account’s list, not cleared, on a switch after it was found', async () => {
		const {storage, account, inspected, stop} = await foundOperation();
		try {
			storage.hold();
			account.set(BOB);
			expect(get(inspected)).toEqual({status: 'loading', key: '1000'});
			storage.release();
			await vi.waitFor(() =>
				expect(get(inspected)).toEqual({status: 'missing', key: '1000'}),
			);
		} finally {
			stop();
		}
	});
});
