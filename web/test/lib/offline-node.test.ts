import 'fake-indexeddb/auto';
import {describe, it, expect} from 'vitest';
import {createWalletClient, custom, parseEther} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {startEmbeddedNode} from '$lib/embedded/node';
import {offlineWorldNode, type WorkerLike} from '$lib/offline-node';
import {exposeOfflineNode} from '$lib/offline-node-host';

// No `.svelte.` infix: the `server` project, in node, which has no `Worker`.
//
// THE FAKE WORKER IS A `MessageChannel`: one port is what the page holds, the
// other has the real Worker-side api exposed on it. So every option crosses a
// real structured clone, exactly as it does into a Worker (a persistence
// adapter passed from the page would fail here as it fails there), and the
// node behind it is a real webevm node.

const KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ACCOUNT = privateKeyToAccount(KEY);

function fakeWorker(log: string[]): {
	worker: () => WorkerLike;
	made: () => number;
} {
	let made = 0;
	return {
		made: () => made,
		worker: () => {
			made++;
			const {port1, port2} = new MessageChannel();
			exposeOfflineNode(port2 as never);
			return {
				postMessage: (message: unknown, transfer?: Transferable[]) =>
					port1.postMessage(message, (transfer ?? []) as never),
				addEventListener: port1.addEventListener.bind(port1) as never,
				removeEventListener: port1.removeEventListener.bind(port1) as never,
				start: () => port1.start(),
				terminate: () => {
					log.push('terminate');
					port1.close();
					port2.close();
				},
			};
		},
	};
}

async function blockNumber(provider: {
	request: (args: {method: string}) => Promise<unknown>;
}) {
	return BigInt(
		(await provider.request({method: 'eth_blockNumber'})) as string,
	);
}

describe("the offline world's node", () => {
	it('is the main-thread node outside a browser, persisted on this thread', () => {
		expect(typeof Worker).toBe('undefined');
		const choice = offlineWorldNode({db: 'offline-node-test:main'});
		expect(choice.where).toBe('main-thread');
		expect(choice.createNode).toBeUndefined();
		expect(choice.persistence).toBeDefined();
	});

	it('is Worker-hosted when a Worker is given, with its persistence built in the Worker', async () => {
		const log: string[] = [];
		const fake = fakeWorker(log);
		const db = 'offline-node-test:restore';
		const choice = offlineWorldNode({db, worker: fake.worker});
		expect(choice.where).toBe('worker');
		expect(choice.persistence).toBeUndefined();

		const node = await startEmbeddedNode({
			chainId: 31337,
			initialBalances: {[ACCOUNT.address]: parseEther('10')},
			createNode: choice.createNode,
		});
		expect(fake.made()).toBe(1);
		const wallet = createWalletClient({
			account: ACCOUNT,
			chain: {
				id: 31337,
				name: 'test',
				nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
				rpcUrls: {default: {http: []}},
			},
			transport: custom(node.provider as never),
		});
		await wallet.sendTransaction({
			to: '0x00000000000000000000000000000000000c0ffe',
			value: parseEther('1'),
		});
		const head = await blockNumber(node.provider);
		expect(head).toBe(1n);
		await node.dispose();
		await choice.released();

		// A RELOAD: a new Worker, the same database, the same chain.
		const again = offlineWorldNode({db, worker: fake.worker});
		const restored = await startEmbeddedNode({
			chainId: 31337,
			createNode: again.createNode,
		});
		expect(await blockNumber(restored.provider)).toBe(head);
		await restored.dispose();
		await again.released();
	});

	it('terminates the Worker only after the save barrier has settled', async () => {
		const log: string[] = [];
		const fake = fakeWorker(log);
		const choice = offlineWorldNode({
			db: 'offline-node-test:barrier',
			worker: fake.worker,
		});
		const node = await startEmbeddedNode({
			chainId: 31337,
			createNode: choice.createNode,
		});

		// What `letGoOfWorld` does: dispose, THEN one more request as the
		// "everything is saved" barrier.
		await node.dispose();
		log.push('disposed');
		expect(log).toEqual(['disposed']);
		await node.provider.request({method: 'eth_blockNumber'});
		log.push('barrier settled');
		await choice.released();
		expect(log).toEqual(['disposed', 'barrier settled', 'terminate']);

		// And a request after that is refused rather than left hanging.
		await expect(
			node.provider.request({method: 'eth_blockNumber'}),
		).rejects.toThrow(/disposed/);
	});

	it('terminates the Worker on dispose even when nobody sends a barrier', async () => {
		const log: string[] = [];
		const choice = offlineWorldNode({
			db: 'offline-node-test:no-barrier',
			worker: fakeWorker(log).worker,
		});
		const node = await startEmbeddedNode({
			chainId: 31337,
			createNode: choice.createNode,
		});
		await node.dispose();
		await choice.released();
		expect(log).toEqual(['terminate']);
	});

	it('refuses a persistence adapter from the page, which cannot cross into a Worker', async () => {
		const choice = offlineWorldNode({
			db: 'offline-node-test:refused',
			worker: fakeWorker([]).worker,
		});
		await expect(
			startEmbeddedNode({
				chainId: 31337,
				createNode: choice.createNode,
				persistence: {load: async () => null, save: async () => {}},
			}),
		).rejects.toThrow(/persistence/);
	});
});
