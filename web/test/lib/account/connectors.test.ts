import {describe, it, expect} from 'vitest';
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

	it('records fetched transactions as well as broadcasts', () => {
		const {walletClient, connector} = setup();
		connector.connect();

		expect(walletClient.listenerCount('transaction:fetched')).toBe(1);

		connector.disconnect();
		expect(walletClient.listenerCount('transaction:fetched')).toBe(0);
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
		expect(walletClient.listenerCount('transaction:fetched')).toBe(0);
	});

	it('drops events once disconnected', () => {
		const {walletClient, connector, added} = setup();
		connector.connect();
		connector.disconnect();

		walletClient.emit('transaction:broadcasted', tx('0xdead'));
		expect(added).toHaveLength(0);
	});
});
