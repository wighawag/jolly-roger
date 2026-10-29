import {describe, it, expect, vi} from 'vitest';
import {StoreUnavailableError, type StoreWriter} from 'synqable';
import {createAccountData} from '../../../src/lib/account/AccountData';
import {
	AccountDataNotStoredError,
	createDurableWrite,
} from '../../../src/lib/account/durable-write';
import {
	ALICE,
	BOB,
	SCOPE,
	accountStore,
	clock,
	controlledStorage,
	deployments,
	storageKey,
	trackedTransaction,
} from './account-data-harness';

/**
 * `writeDurably` is the write a commit-reveal submission makes before it sends
 * a commitment: resolved must mean ON STORAGE, and every way it cannot be must
 * reject rather than resolve or hang.
 */

const OPERATION = {
	metadata: {type: 'unknown', name: 'secret'},
	call: {
		from: ALICE,
		to: null,
		value: 0n,
		data: '0x',
		source: 'wallet',
	},
	attempts: [],
} as never;

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
	// Subscribing is what starts the multi-account store.
	const stop = accountData.subscribe(() => {});
	return {storage, account, accountData, stop};
}

function storedOperations(
	storage: ReturnType<typeof controlledStorage>,
	account: `0x${string}`,
) {
	return (
		storage.saved.get(storageKey(account)) as
			{data: {operations: Record<string, unknown>}} | undefined
	)?.data.operations;
}

async function rejection(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('expected a rejection');
}

describe('writeDurably', () => {
	it('resolves once the write is on storage, not before', async () => {
		const {storage, accountData, stop} = setup(ALICE);
		try {
			const done = accountData.writeDurably((writer) => {
				writer.addItem('operations', 'turn', OPERATION, {deleteAt: 10_000});
				return 'written';
			});
			// The save settles on a later task: nothing is stored yet.
			expect(storedOperations(storage, ALICE)?.turn).toBeUndefined();

			await expect(done).resolves.toBe('written');
			expect(storedOperations(storage, ALICE)?.turn).toBeDefined();
		} finally {
			stop();
		}
	});

	it('waits for the account data to load before writing', async () => {
		const {storage, account, accountData, stop} = setup(undefined);
		storage.hold();
		try {
			account.set(ALICE);
			const write = vi.fn();
			const done = accountData.writeDurably(write);
			await Promise.resolve();
			expect(write).not.toHaveBeenCalled();

			storage.release();
			await done;
			expect(write).toHaveBeenCalledOnce();
		} finally {
			stop();
		}
	});

	it('rejects when the save fails, with the storage error as cause', async () => {
		const {storage, accountData, stop} = setup(ALICE);
		try {
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));
			const failure = new Error('quota exceeded');
			storage.saveError = failure;

			const error = await rejection(
				accountData.writeDurably((writer) =>
					writer.addItem('operations', 'turn', OPERATION, {deleteAt: 10_000}),
				),
			);
			expect(error).toBeInstanceOf(AccountDataNotStoredError);
			expect((error as AccountDataNotStoredError).cause).toBe(failure);
			expect((error as AccountDataNotStoredError).account).toBe(ALICE);
			expect(storedOperations(storage, ALICE)?.turn).toBeUndefined();
		} finally {
			stop();
		}
	});

	it('rejects with load-failed, the load error as cause, when the load fails', async () => {
		const {storage, account, accountData, stop} = setup(undefined);
		const failure = new Error('storage is unreadable');
		storage.loadError = failure;
		try {
			account.set(ALICE);
			const write = vi.fn();
			const error = await rejection(accountData.writeDurably(write));
			expect(error).toBeInstanceOf(StoreUnavailableError);
			expect((error as StoreUnavailableError).reason).toBe('load-failed');
			expect((error as StoreUnavailableError).cause).toBe(failure);
			expect(write).not.toHaveBeenCalled();
		} finally {
			stop();
		}
	});

	it('rejects with account-switched when the account changes before the load', async () => {
		const {storage, account, accountData, stop} = setup(undefined);
		storage.hold();
		try {
			account.set(ALICE);
			const write = vi.fn();
			const done = rejection(accountData.writeDurably(write));
			account.set(BOB);
			storage.release();

			const error = await done;
			expect(error).toBeInstanceOf(StoreUnavailableError);
			expect((error as StoreUnavailableError).reason).toBe('account-switched');
			expect(write).not.toHaveBeenCalled();
			expect(storedOperations(storage, BOB)).toBeUndefined();
		} finally {
			stop();
		}
	});

	it('rejects with no-account at once when nothing is connected', async () => {
		const {accountData, stop} = setup(undefined);
		try {
			const write = vi.fn();
			const error = await rejection(accountData.writeDurably(write));
			expect(error).toBeInstanceOf(StoreUnavailableError);
			expect((error as StoreUnavailableError).reason).toBe('no-account');
			expect(write).not.toHaveBeenCalled();
		} finally {
			stop();
		}
	});

	it('leaves the other write paths working beside it', async () => {
		const {storage, accountData, stop} = setup(ALICE);
		try {
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));
			accountData.addOperationFromTrackedTransaction(
				trackedTransaction(ALICE, 3),
			);
			await accountData.writeDurably(() => {});
			expect(Object.keys(storedOperations(storage, ALICE) ?? {})).toHaveLength(
				1,
			);
		} finally {
			stop();
		}
	});
	it('resolves when its write is stored, though a later write’s save then fails', async () => {
		const {storage, accountData, stop} = setup(ALICE);
		try {
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));
			storage.holdSaves();
			const done = accountData.writeDurably((writer) =>
				writer.addItem('operations', 'turn', OPERATION, {deleteAt: 10_000}),
			);
			// Our save has started (held) and writeDurably is waiting on it.
			await vi.waitFor(() => expect(storage.saves).toBe(1));
			await new Promise((r) => setTimeout(r, 0));

			// Another write, whose save is queued behind ours and will fail.
			storage.saveError = new Error('quota exceeded');
			accountData.writer()!.addItem('operations', 'other', OPERATION, {
				deleteAt: 10_000,
				immediate: true,
			});
			storage.releaseSaves();

			await expect(done).resolves.toBeUndefined();
			expect(storedOperations(storage, ALICE)?.turn).toBeDefined();
			expect(storedOperations(storage, ALICE)?.other).toBeUndefined();
		} finally {
			stop();
		}
	});

	it('resolves after an earlier failed save once storage works again', async () => {
		const {storage, accountData, stop} = setup(ALICE);
		try {
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));
			storage.saveError = new Error('quota exceeded');
			await expect(
				accountData.writeDurably((writer) =>
					writer.addItem('operations', 'turn', OPERATION, {deleteAt: 10_000}),
				),
			).rejects.toBeInstanceOf(AccountDataNotStoredError);

			storage.saveError = undefined;
			// Nothing new to write: the earlier failure must not be reported now,
			// and the write it lost is stored by the retry.
			await expect(accountData.writeDurably(() => {})).resolves.toBeUndefined();
			expect(storedOperations(storage, ALICE)?.turn).toBeDefined();
		} finally {
			stop();
		}
	});
});

describe('createDurableWrite, against the store it is handed', () => {
	function fakeWriter() {
		const calls: {method: string; options: unknown}[] = [];
		const record =
			(method: string) =>
			(...args: unknown[]) => {
				calls.push({method, options: args[args.length - 1]});
			};
		const persisted = vi.fn(async () => {});
		const writer = {
			account: ALICE,
			read: () => ({}),
			persisted,
			set: record('set'),
			update: record('update'),
			addItem: record('addItem'),
			setItem: record('setItem'),
			updateItem: record('updateItem'),
			patch: record('patch'),
			patchItem: record('patchItem'),
			removeItem: record('removeItem'),
		} as unknown as StoreWriter<never>;
		return {writer, calls, persisted};
	}

	function fakeStore(writer: StoreWriter<never>, current: StoreWriter<never>) {
		const target = {writer: () => current};
		return {
			store: {
				ready: async () => writer,
				get: () => target as never,
			},
		};
	}

	it('rejects with account-switched, writing nothing, when the current store is no longer the handle’s', async () => {
		const {writer, calls, persisted} = fakeWriter();
		const other = fakeWriter().writer;
		const {store} = fakeStore(writer, other);
		const write = vi.fn();

		const error = await rejection(createDurableWrite(store as never)(write));
		expect(error).toBeInstanceOf(StoreUnavailableError);
		expect((error as StoreUnavailableError).reason).toBe('account-switched');
		expect(write).not.toHaveBeenCalled();
		expect(calls).toHaveLength(0);
		expect(persisted).not.toHaveBeenCalled();
	});

	it('forces immediate on every mutator, keeping the caller’s options', async () => {
		const {writer, calls, persisted} = fakeWriter();
		const {store} = fakeStore(writer, writer);

		await createDurableWrite(store as never)((w) => {
			const any = w as unknown as Record<string, (...args: unknown[]) => void>;
			any.set('f', 1);
			any.update('f', {});
			any.addItem('m', 'k', 1, {deleteAt: 5});
			any.setItem('m', 'k', 1);
			any.updateItem('m', 'k', {});
			any.patch('f', (x: unknown) => x);
			any.patchItem('m', 'k', (x: unknown) => x);
			any.removeItem('m', 'k', {ignoreMissing: true});
		});

		expect(calls.map((c) => c.method)).toEqual([
			'set',
			'update',
			'addItem',
			'setItem',
			'updateItem',
			'patch',
			'patchItem',
			'removeItem',
		]);
		for (const call of calls) {
			expect(call.options).toMatchObject({immediate: true});
		}
		expect(calls[2].options).toEqual({deleteAt: 5, immediate: true});
		expect(calls[7].options).toEqual({ignoreMissing: true, immediate: true});
		expect(persisted).toHaveBeenCalledOnce();
	});
});
