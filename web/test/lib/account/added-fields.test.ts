import {describe, it, expect, expectTypeOf, vi} from 'vitest';
import {get} from 'svelte/store';
import {defineSchema, map, record, value} from 'synqable';
import {
	createAccountData,
	type AccountDataStore,
	type MultiAccountDataStore,
} from '../../../src/lib/account/AccountData';
import {
	ALICE,
	SCOPE,
	accountStore,
	clock,
	controlledStorage,
	deployments,
	storageKey,
	trackedTransaction,
} from './account-data-harness';

/**
 * An app adds its own fields to the account data beside `operations` (the
 * commit-reveal submissions, for one), typed through `defineSchema`, and reads
 * and writes them through the same handle as the framework, with no cast.
 */

type Submission = {cycle: number; secret: `0x${string}`};

const appFields = {
	schema: defineSchema({
		submissions: map<Submission>(),
		settings: value<{sound: boolean; volume: number}>(),
		profile: record<{name: string; colour: string}>(),
	}),
	defaults: () => ({
		submissions: {},
		settings: {sound: true, volume: 5},
		profile: {name: 'anonymous', colour: 'grey'},
	}),
};

function setup(storage = controlledStorage()) {
	const account = accountStore(ALICE);
	const accountData = createAccountData({
		accountStore: account,
		deployments,
		clock,
		scopeAddress: SCOPE,
		storageAdapter: storage.adapter,
		fields: appFields,
	});
	const stop = accountData.subscribe(() => {});
	return {storage, account, accountData, stop};
}

describe('fields an app adds to its account data', () => {
	it('are written and read through the handle, typed, with no cast', async () => {
		const {storage, accountData, stop} = setup();
		try {
			const writer = await accountData.ready();
			writer.addItem(
				'submissions',
				'cycle-3',
				{cycle: 3, secret: '0x01'},
				{deleteAt: 10_000},
			);
			writer.patch('settings', (current) => ({...current, volume: 7}));
			writer.update('profile', {name: 'alice'});

			const data = writer.read();
			expectTypeOf(
				data.submissions['cycle-3'].secret,
			).toEqualTypeOf<`0x${string}`>();
			expectTypeOf(data.settings.volume).toEqualTypeOf<number>();
			expect(data.submissions['cycle-3']).toMatchObject({
				cycle: 3,
				secret: '0x01',
			});
			expect(data.settings).toEqual({sound: true, volume: 7});
			expect(data.profile).toEqual({name: 'alice', colour: 'grey'});

			await accountData.get()!.flush();
			await accountData.writeDurably((w) =>
				w.setItem('submissions', 'cycle-3', {cycle: 3, secret: '0x02'}),
			);
			const stored = storage.saved.get(storageKey(ALICE)) as {
				data: {submissions: Record<string, Submission>};
			};
			expect(stored.data.submissions['cycle-3'].secret).toBe('0x02');
		} finally {
			stop();
		}
	});

	it('are watched like the framework’s own', async () => {
		const {accountData, stop} = setup();
		try {
			const settings = accountData.watchField('settings');
			expectTypeOf(get(settings)).toEqualTypeOf<
				{sound: boolean; volume: number} | undefined
			>();
			await vi.waitFor(() =>
				expect(get(settings)).toEqual({sound: true, volume: 5}),
			);
			accountData.writer()!.set('settings', {sound: false, volume: 1});
			expect(get(settings)).toEqual({sound: false, volume: 1});
		} finally {
			stop();
		}
	});

	it('load with their defaults from data stored before they existed', async () => {
		const storage = controlledStorage();
		// What a build without the added fields saved: operations only.
		const before = setupWithoutFields(storage);
		await vi.waitFor(() => expect(before.accountData.isReady()).toBe(true));
		before.accountData.addOperationFromTrackedTransaction(
			trackedTransaction(ALICE, 4),
		);
		await before.accountData.get()!.flush();
		before.stop();
		const stored = storage.saved.get(storageKey(ALICE)) as {
			data: Record<string, unknown>;
		};
		expect(Object.keys(stored.data)).toEqual(['operations']);

		const {accountData, stop} = setup(storage);
		try {
			const data = (await accountData.ready()).read();
			expect(Object.values(data.operations)).toHaveLength(1);
			expect(data.submissions).toEqual({});
			expect(data.settings).toEqual({sound: true, volume: 5});
			expect(data.profile).toEqual({name: 'anonymous', colour: 'grey'});
		} finally {
			stop();
		}
	});

	it('never replace a value that is stored', async () => {
		const storage = controlledStorage();
		const first = setup(storage);
		(await first.accountData.ready()).set('settings', {
			sound: false,
			volume: 9,
		});
		await first.accountData.get()!.flush();
		first.stop();

		const {accountData, stop} = setup(storage);
		try {
			const data = (await accountData.ready()).read();
			expect(data.settings).toEqual({sound: false, volume: 9});
		} finally {
			stop();
		}
	});

	it('leave the framework’s operations working', async () => {
		const {accountData, stop} = setup();
		try {
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));
			accountData.addOperationFromTrackedTransaction(
				trackedTransaction(ALICE, 9),
			);
			expect(Object.keys(accountData.writer()!.read().operations)).toHaveLength(
				1,
			);
		} finally {
			stop();
		}
	});

	it('type-check as the framework’s account data, and cannot redefine operations', () => {
		const {accountData, stop} = setup();
		stop();
		expectTypeOf(accountData).toEqualTypeOf<
			AccountDataStore<typeof appFields.schema>
		>();
		// Anything the framework hands the account data to takes an app's too.
		const asFramework: MultiAccountDataStore = accountData;
		expect(asFramework).toBe(accountData);

		const clashing = {
			schema: defineSchema({operations: map<number>()}),
			defaults: () => ({operations: {}}),
		};
		expect(() =>
			createAccountData({
				accountStore: accountStore(undefined),
				deployments,
				clock,
				scopeAddress: SCOPE,
				// @ts-expect-error `operations` is the framework's field
				fields: clashing,
			}),
		).not.toThrow();
	});
});

function setupWithoutFields(storage: ReturnType<typeof controlledStorage>) {
	const accountData = createAccountData({
		accountStore: accountStore(ALICE),
		deployments,
		clock,
		scopeAddress: SCOPE,
		storageAdapter: storage.adapter,
	});
	const stop = accountData.subscribe(() => {});
	return {accountData, stop};
}
