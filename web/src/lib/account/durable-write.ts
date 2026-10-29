import {
	StoreUnavailableError,
	type MultiAccountStore,
	type Schema,
	type StoreWriter,
} from 'synqable';

/**
 * A durable write's data did not reach storage: the save failed. The write
 * itself was accepted (the account data holds it in memory and a later save
 * may still persist it), but nothing that depends on it being STORED may
 * proceed. `cause` is the storage's own error.
 */
export class AccountDataNotStoredError extends Error {
	readonly account: `0x${string}`;
	constructor(account: `0x${string}`, cause: Error) {
		super(`account data for ${account} could not be stored: ${cause.message}`, {
			cause,
		});
		this.name = 'AccountDataNotStoredError';
		this.account = account;
	}
}

/**
 * The handle a durable write receives: the account's own, except that every
 * mutator saves AT ONCE (`{immediate: true}`), so the save starts with the write
 * rather than after the debounce. The caller's options are kept; only
 * `immediate` is forced.
 */
function immediateWriter<S extends Schema>(
	writer: StoreWriter<S>,
): StoreWriter<S> {
	return {
		get account() {
			return writer.account;
		},
		read: () => writer.read(),
		persisted: () => writer.persisted(),
		set: (field, value, options) =>
			writer.set(field, value, {...options, immediate: true}),
		update: (field, value, options) =>
			writer.update(field, value, {...options, immediate: true}),
		addItem: (field, key, value, options) =>
			writer.addItem(field, key, value, {...options, immediate: true}),
		setItem: (field, key, value, options) =>
			writer.setItem(field, key, value, {...options, immediate: true}),
		updateItem: (field, key, value, options) =>
			writer.updateItem(field, key, value, {...options, immediate: true}),
		patch: (field, updateFn, options) =>
			writer.patch(field, updateFn, {...options, immediate: true}),
		patchItem: (field, key, updateFn, options) =>
			writer.patchItem(field, key, updateFn, {...options, immediate: true}),
		removeItem: (field, key, options) =>
			writer.removeItem(field, key, {...options, immediate: true}),
	};
}

/**
 * A write that resolves only once its data is ON STORAGE.
 *
 * For a writer that must not act before its data is stored: the commit-reveal
 * submission stores a turn's secret this way before it sends the commit, since
 * a commitment whose secret is lost cannot be revealed and costs the stake.
 *
 * 1. It waits for the CURRENT account's data to load (`ready()`), and rejects
 *    with synqable's `StoreUnavailableError` from there unchanged: `no-account`
 *    at once, `account-switched` when the account changes before the load,
 *    `load-failed` (the load error as `cause`), or `stopped`.
 * 2. It checks that handle is still the current store's. `ready()` resolves on
 *    a later microtask, and the account may have switched in between; the
 *    handle would then throw anyway, but the check here makes that an
 *    `account-switched` rejection BEFORE anything is written. A handle is the
 *    same object for its store's lifetime, so `writer()` on the current store
 *    being this handle means "this is the store written to".
 * 3. It runs `write` with that handle, every mutator forced `{immediate: true}`.
 *    Its result is returned. It may be async, and what it writes before it
 *    settles is what is waited for, but a handle used after an account switch
 *    throws, so keep it synchronous unless it must wait. Anything it throws
 *    rejects the call, and nothing is waited for.
 * 4. It awaits the handle's `persisted()` (synqable 0.3): resolved once a save
 *    that includes every write made before the call has succeeded, rejected
 *    with the storage error when the save that included them failed and none
 *    is queued, which this turns into {@link AccountDataNotStoredError}. The
 *    handle names the store written to, so an account switch after the write
 *    still waits for that store's save. Saves other writes trigger cannot make
 *    it reject, and an earlier failed save does not either when this one
 *    succeeds (`persisted()` retries), which the 0.2 version, a `flush()` then
 *    a read of `storageStatus$`'s `storageError`, got wrong both ways.
 */
export function createDurableWrite<S extends Schema>(
	store: Pick<MultiAccountStore<S>, 'ready' | 'get'>,
) {
	return async function writeDurably<T>(
		write: (writer: StoreWriter<S>) => T,
	): Promise<Awaited<T>> {
		const writer = await store.ready();

		if (store.get()?.writer() !== writer) {
			throw new StoreUnavailableError(
				'account-switched',
				`The account changed from ${writer.account} before its data could be written`,
				{account: writer.account},
			);
		}

		const result = await write(immediateWriter(writer));

		try {
			await writer.persisted();
		} catch (error) {
			throw new AccountDataNotStoredError(
				writer.account,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
		return result;
	};
}
