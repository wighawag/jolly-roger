import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
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
			addTransactionToOperation: (_id: string, tx: unknown) => added.push(tx),
			updateOperationFromFetchedTransaction: () => {},
		} as never,
	};
}

function setup(executorInitial: unknown) {
	const walletClient = makeFakeClient();
	const executor = writable(executorInitial);
	const {added, accountData} = makeFakeAccountData();
	const connector = createTrackedWalletConnector({
		clients: [walletClient as never],
		executors: [executor as never],
		accountData,
	});
	return {walletClient, executor, connector, added};
}

const ready = (client: unknown, address = '0x1') => ({
	status: 'ready',
	address,
	account: address,
	client,
});

const tx = (hash: string) => ({hash, metadata: {}});

describe('createTrackedWalletConnector', () => {
	it('attaches the wallet client and records its broadcasts', () => {
		const {walletClient, connector, added} = setup({status: 'not-connected'});
		connector.connect();
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(1);
		walletClient.emit('transaction:broadcasted', tx('0x01'));
		expect(added).toHaveLength(1);
		connector.disconnect();
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(0);
	});

	it('does not double-attach when an executor exposes the wallet client', () => {
		const walletClient = makeFakeClient();
		const executor = writable({
			status: 'ready',
			address: '0x1',
			account: '0x1',
			client: walletClient,
		});
		const {added, accountData} = makeFakeAccountData();
		const connector = createTrackedWalletConnector({
			clients: [walletClient as never],
			executors: [executor as never],
			accountData,
		});
		connector.connect();
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(1);
		walletClient.emit('transaction:broadcasted', tx('0x01'));
		expect(added).toHaveLength(1); // recorded once, not twice
		connector.disconnect();
	});

	it('detaches the previous signer client when a new one replaces it', () => {
		const signerA = makeFakeClient();
		const signerB = makeFakeClient();
		const {walletClient, executor, connector, added} = setup({
			status: 'ready',
			address: '0xa',
			account: '0xa',
			client: signerA,
		});
		connector.connect();
		expect(signerA.listenerCount('transaction:broadcasted')).toBe(1);

		// Re-sign-in as a different identity: executor exposes a NEW client.
		executor.set({
			status: 'ready',
			address: '0xb',
			account: '0xb',
			client: signerB,
		});
		expect(signerA.listenerCount('transaction:broadcasted')).toBe(0);
		expect(signerB.listenerCount('transaction:broadcasted')).toBe(1);

		// A late event from the stale client must NOT reach account data.
		signerA.emit('transaction:broadcasted', tx('0xdead'));
		expect(added).toHaveLength(0);
		signerB.emit('transaction:broadcasted', tx('0x02'));
		expect(added).toHaveLength(1);

		connector.disconnect();
		expect(signerB.listenerCount('transaction:broadcasted')).toBe(0);
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(0);
	});

	it('keeps the signer attachment across transient not-ready states', () => {
		const signerA = makeFakeClient();
		const {executor, connector} = setup({
			status: 'ready',
			address: '0xa',
			account: '0xa',
			client: signerA,
		});
		connector.connect();
		expect(signerA.listenerCount('transaction:broadcasted')).toBe(1);

		// Mid-reconnect blip: same identity will come back.
		executor.set({status: 'not-connected'});
		expect(signerA.listenerCount('transaction:broadcasted')).toBe(1);
		executor.set({
			status: 'ready',
			address: '0xa',
			account: '0xa',
			client: signerA,
		});
		expect(signerA.listenerCount('transaction:broadcasted')).toBe(1); // still exactly one

		connector.disconnect();
	});
});

/**
 * The senders that are built once with the context and never swapped: the app's
 * wallet client, and the payment rail's.
 *
 * The rail is the reason this is a LIST. It is neither the app's wallet client
 * nor an executor, so under the old `walletClient` + `executors` shape it had
 * nowhere to go and was simply left out: every silent move the signer made was
 * listed, and the one transaction the user consciously paid money for was not.
 */
describe('createTrackedWalletConnector with several fixed clients', () => {
	it('records what a second fixed client broadcasts', () => {
		// The payment rail. Nobody's executor, nobody's signer, and the only client
		// whose transactions cost the user real money.
		const walletClient = makeFakeClient();
		const paymentClient = makeFakeClient();
		const {added, accountData} = makeFakeAccountData();
		const connector = createTrackedWalletConnector({
			clients: [walletClient as never, paymentClient as never],
			executors: [],
			accountData,
		});
		connector.connect();

		paymentClient.emit('transaction:broadcasted', tx('0x01'));
		expect(added).toHaveLength(1);

		connector.disconnect();
		expect(paymentClient.listenerCount('transaction:broadcasted')).toBe(0);
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(0);
	});

	it('hands a payment account data cannot take to the fallback', () => {
		// The fallback covers EVERY client, not just the app's wallet one: a
		// purchase that cannot be filed is lost exactly the same way, and the
		// in-flight ledger already holds a record the hash can be attached to.
		const paymentClient = makeFakeClient();
		const seen: unknown[] = [];
		const connector = createTrackedWalletConnector({
			clients: [makeFakeClient() as never, paymentClient as never],
			executors: [],
			accountData: makeUnavailableAccountData(),
			onUnrecordedBroadcast: ((params: unknown) => seen.push(params)) as never,
		});
		connector.connect();

		expect(() =>
			paymentClient.emit('transaction:broadcasted', broadcastTx),
		).not.toThrow();
		expect(seen).toHaveLength(1);

		connector.disconnect();
	});

	it('attaches the same client once when it is listed twice', () => {
		const client = makeFakeClient();
		const {added, accountData} = makeFakeAccountData();
		const connector = createTrackedWalletConnector({
			clients: [client as never, client as never],
			executors: [],
			accountData,
		});
		connector.connect();

		expect(client.listenerCount('transaction:broadcasted')).toBe(1);
		client.emit('transaction:broadcasted', tx('0x01'));
		expect(added).toHaveLength(1);

		connector.disconnect();
		expect(client.listenerCount('transaction:broadcasted')).toBe(0);
	});

	it('does not double-attach when an executor exposes a later fixed client', () => {
		// The skip must consider the whole list, not just its first entry.
		const walletClient = makeFakeClient();
		const paymentClient = makeFakeClient();
		const {added, accountData} = makeFakeAccountData();
		const connector = createTrackedWalletConnector({
			clients: [walletClient as never, paymentClient as never],
			executors: [writable(ready(paymentClient, '0x9')) as never],
			accountData,
		});
		connector.connect();

		expect(paymentClient.listenerCount('transaction:broadcasted')).toBe(1);
		paymentClient.emit('transaction:broadcasted', tx('0x01'));
		expect(added).toHaveLength(1);

		connector.disconnect();
		expect(paymentClient.listenerCount('transaction:broadcasted')).toBe(0);
	});
});

describe('createTrackedWalletConnector with two executors', () => {
	it('records transactions from both accounts into one list', () => {
		// Operations belong to the player, not to the key that signed. The
		// signer's silent work and the user's own prompted transactions land in
		// the same place, and a consumer that wants them apart filters on `from`.
		const walletClient = makeFakeClient();
		const signerClient = makeFakeClient();
		const {added, accountData} = makeFakeAccountData();
		const connector = createTrackedWalletConnector({
			clients: [walletClient as never],
			executors: [
				writable(ready(walletClient, '0x1')) as never,
				writable(ready(signerClient, '0x2')) as never,
			],
			accountData,
		});
		connector.connect();

		walletClient.emit('transaction:broadcasted', tx('0x01'));
		signerClient.emit('transaction:broadcasted', tx('0x02'));
		expect(added).toHaveLength(2);

		connector.disconnect();
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(0);
		expect(signerClient.listenerCount('transaction:broadcasted')).toBe(0);
	});

	it('attaches a shared client once, not once per executor', () => {
		// Both executors pointed at the same signer (which is what a memoised
		// factory produces). Attaching twice would record every transaction twice.
		const walletClient = makeFakeClient();
		const signerClient = makeFakeClient();
		const {added, accountData} = makeFakeAccountData();
		const connector = createTrackedWalletConnector({
			clients: [walletClient as never],
			executors: [
				writable(ready(signerClient, '0x2')) as never,
				writable(ready(signerClient, '0x2')) as never,
			],
			accountData,
		});
		connector.connect();

		expect(signerClient.listenerCount('transaction:broadcasted')).toBe(1);
		signerClient.emit('transaction:broadcasted', tx('0x01'));
		expect(added).toHaveLength(1);

		connector.disconnect();
		expect(signerClient.listenerCount('transaction:broadcasted')).toBe(0);
	});

	it('one executor swapping its client leaves the other attached', () => {
		const walletClient = makeFakeClient();
		const signerClient = makeFakeClient();
		const replacement = makeFakeClient();
		const {accountData} = makeFakeAccountData();
		const signerExecutor = writable(ready(signerClient, '0x2'));
		const connector = createTrackedWalletConnector({
			clients: [walletClient as never],
			executors: [
				writable(ready(walletClient, '0x1')) as never,
				signerExecutor as never,
			],
			accountData,
		});
		connector.connect();

		// Re-sign-in as another identity: a different key, so a different client.
		signerExecutor.set(ready(replacement, '0x3'));
		expect(signerClient.listenerCount('transaction:broadcasted')).toBe(0);
		expect(replacement.listenerCount('transaction:broadcasted')).toBe(1);
		// The account executor is untouched by its neighbour's swap.
		expect(walletClient.listenerCount('transaction:broadcasted')).toBe(1);

		connector.disconnect();
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
		updateOperationFromFetchedTransaction: fail,
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
			clients: [walletClient as never],
			// No executors: this is about the always-present wallet client, and an
			// executor would only add a second client saying the same thing.
			executors: [],
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
			clients: [walletClient as never],
			executors: [],
			accountData,
			onUnrecordedBroadcast: (() => seen.push(true)) as never,
		});
		connector.connect();

		walletClient.emit('transaction:broadcasted', broadcastTx);

		expect(added).toHaveLength(1);
		expect(seen).toHaveLength(0);
	});

	it('does not let a fetched-data failure throw either', () => {
		// Milder: the tracker already catches this one, but it then logs "could not
		// fetch tx", which is a misleading thing to print about a fetch that worked.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const {walletClient, connector} = setupUnavailable();
			connector.connect();

			expect(() =>
				walletClient.emit('transaction:fetched', broadcastTx),
			).not.toThrow();
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});
