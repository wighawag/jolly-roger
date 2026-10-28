import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {createAccountData} from '../../../../src/lib/account/AccountData';
import type {OverlayState} from '../../../../src/lib/core/ui/overlay';
import {watchOverlayOperation} from '../../../../src/lib/ui/pending-operation/overlays';
import {
	ALICE,
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
});
