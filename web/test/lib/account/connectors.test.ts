import {describe, it, expect, vi} from 'vitest';
import {createTrackedWalletConnector} from '../../../src/lib/account/connectors';

/**
 * Fake tracked client exposing only `on` (the surface the connector uses),
 * with introspection for how many listeners are currently attached and the
 * ability to emit events to them.
 */
function makeFakeClient() {
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	return {
		on(event: string, listener: (data: unknown) => void) {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(listener);
			return () => set!.delete(listener);
		},
		emit(event: string, data: unknown) {
			for (const listener of listeners.get(event) ?? []) listener(data);
		},
		listenerCount(event: string) {
			return listeners.get(event)?.size ?? 0;
		},
	};
}

/** Records which transactions reached account data (the connector's sink). */
function makeFakeAccountData() {
	const added: unknown[] = [];
	return {
		added,
		accountData: {
			addOperationFromTrackedTransaction: (tx: unknown) => added.push(tx),
			// Returns true, as the real one does when the operation exists: the
			// connector falls back to creating an operation when it returns false.
			addTransactionToOperation: (_id: string, tx: unknown) => {
				added.push(tx);
				return true;
			},
			updateOperationFromKnownTransaction: () => {},
		} as never,
	};
}

function setup() {
	const walletClient = makeFakeClient();
	const {added, accountData} = makeFakeAccountData();
	const connector = createTrackedWalletConnector({
		walletClient: walletClient as never,
		accountData,
	});
	return {walletClient, connector, added};
}

const tx = (hash: string) => ({hash, metadata: {}});

describe('createTrackedWalletConnector', () => {
	it('attaches the wallet client and records its broadcasts', () => {
		const {walletClient, connector, added} = setup();
		connector.connect();

		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(1);
		walletClient.emit('transaction:broadcasted', tx('0x01'));
		expect(added).toHaveLength(1);

		connector.disconnect();
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(0);
	});

	it('records known-value transactions as well as broadcasts', () => {
		const {walletClient, connector} = setup();
		connector.connect();

		expect(walletClient.listenerCount('transaction:known')).toBe(1);

		connector.disconnect();
		expect(walletClient.listenerCount('transaction:known')).toBe(0);
	});

	/**
	 * One client, attached once. This app sends everything through the connected
	 * wallet, so there is no second client to swap in and no identity change that
	 * could leave a stale one writing into another account's data - the failure
	 * an app with a derived signer has to handle, and does not have here.
	 */
	it('attaches exactly once, and leaves nothing behind', () => {
		const {walletClient, connector} = setup();

		connector.connect();
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(1);

		connector.disconnect();
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(0);
		expect(walletClient.listenerCount('transaction:known')).toBe(0);
	});

	it('drops events once disconnected', () => {
		const {walletClient, connector, added} = setup();
		connector.connect();
		connector.disconnect();

		walletClient.emit('transaction:broadcasted', tx('0xdead'));
		expect(added).toHaveLength(0);
	});
});

/**
 * What happens when account data CANNOT take a transaction.
 *
 * Worth its own block because of WHERE this listener runs: inside the tracker's
 * `emit`, which is fail-fast, called by `writeContract` after the transaction has
 * been broadcast and before it returns the hash. A throw here does not merely
 * skip bookkeeping, it rejects a send that already succeeded, and the user is
 * shown an error about a transaction that is on chain.
 *
 * The state is real rather than a bug to assert against: account data belongs to
 * one account at a time, so it is genuinely gone if the account went away
 * between dispatch and answer (a disconnect, an account switch).
 */
function makeUnavailableAccountData() {
	const fail = () => {
		throw new Error('accountData not ready');
	};
	return {
		addOperationFromTrackedTransaction: fail,
		addTransactionToOperation: fail,
		updateOperationFromKnownTransaction: fail,
	} as never;
}

const broadcastTx = {
	hash: '0xdeadbeef' as const,
	from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const,
	nonce: 7,
	metadata: {},
};

describe('createTrackedWalletConnector: a broadcast account data cannot take', () => {
	function setupUnavailable(onUnrecordedBroadcast?: (params: unknown) => void) {
		const walletClient = makeFakeClient();
		const connector = createTrackedWalletConnector({
			walletClient: walletClient as never,
			accountData: makeUnavailableAccountData(),
			onUnrecordedBroadcast: onUnrecordedBroadcast as never,
		});
		return {walletClient, connector};
	}

	it('does not let the failure escape into the send', () => {
		// Observed: this threw, the throw came back out of writeContract, and a
		// greeting that had posted successfully was reported to the user as
		// "Transaction error: accountData not ready".
		const {walletClient, connector} = setupUnavailable(() => {});
		connector.connect();

		expect(() =>
			walletClient.emit('transaction:broadcasted', broadcastTx),
		).not.toThrow();
	});

	it('hands the transaction on rather than dropping it', () => {
		const seen: any[] = [];
		const {walletClient, connector} = setupUnavailable((params) =>
			seen.push(params),
		);
		connector.connect();

		walletClient.emit('transaction:broadcasted', broadcastTx);

		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			from: broadcastTx.from,
			hash: broadcastTx.hash,
			nonce: 7,
		});
	});

	it('says nothing when account data took it normally', () => {
		const walletClient = makeFakeClient();
		const {added, accountData} = makeFakeAccountData();
		const seen: unknown[] = [];
		const connector = createTrackedWalletConnector({
			walletClient: walletClient as never,
			accountData,
			onUnrecordedBroadcast: (() => seen.push(true)) as never,
		});
		connector.connect();

		walletClient.emit('transaction:broadcasted', broadcastTx);

		expect(added).toHaveLength(1);
		expect(seen).toHaveLength(0);
	});

	it('does not let a known-transaction failure throw either', () => {
		// Milder: the tracker already catches this one, but it then logs "could not
		// fetch tx", which is a misleading thing to print about a fetch that worked.
		// (`transaction:known` since tx-tracker 0.2.0: the values are final rather
		// than intended, which is true whether they were fetched or parsed.)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const {walletClient, connector} = setupUnavailable();
			connector.connect();

			expect(() =>
				walletClient.emit('transaction:known', broadcastTx),
			).not.toThrow();
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});
