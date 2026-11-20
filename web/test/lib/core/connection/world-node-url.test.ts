import {describe, it, expect} from 'vitest';
import {readable, get} from 'svelte/store';
import {
	establishConnectionOn,
	establishRemoteConnection,
} from '$lib/core/connection/remote';
import {deployments, type DeploymentsStore} from '$lib/deployments-store';

// No `.svelte.` infix: the server project. A connection is constructible off
// the browser (ADR-0002), and nothing here connects.
//
// WHAT THIS PINS: a connection REPORTS the node url it was built with, rather
// than leaving its caller to assume the app's. A world on another chain (an
// embedded one, reachable only through its provider) is built with none, and
// whatever broadcasts (the local signer, the payment rail) must then follow the
// connection, not `PUBLIC_NODE_URL`. See `EstablishedConnection.nodeURL`, and
// the consumer's case at `integration` (`test/lib/context/`), where the local
// signer meets a world.
describe('a connection says which node it uses', () => {
	const request = {targetStep: 'WalletConnected' as const, walletOnly: true};

	it('reports the url it was given', () => {
		const established = establishConnectionOn({
			...request,
			chainInfo: deployments.get().chain,
			deployments,
			nodeURL: 'http://node.example:8545',
		});
		expect(established.nodeURL).toBe('http://node.example:8545');
	});

	it('reports none when it was given none, as a world in the tab is', () => {
		const established = establishConnectionOn({
			...request,
			chainInfo: deployments.get().chain,
			deployments,
		});
		expect(established.nodeURL).toBeUndefined();
	});

	it('the remote connection reports the app url it took', () => {
		const established = establishRemoteConnection({
			...request,
			nodeURL: 'http://node.example:8545',
		});
		expect(established.nodeURL).toBe('http://node.example:8545');
	});
});

describe('a remote connection may describe records that are not the build', () => {
	it('uses the records it is given, on the same chain', () => {
		// The same chain with the app's contract at another address: what a
		// descendant's table (a game for a fixed set of players) connects to.
		const build = deployments.get();
		const other = {...build};
		const store: DeploymentsStore = {
			...readable(other),
			get: () => other,
		};

		const established = establishRemoteConnection({
			targetStep: 'WalletConnected',
			walletOnly: true,
			deployments: store,
		});

		expect(established.deployments).toBe(store);
		expect(get(established.deployments)).toBe(other);
	});

	it('defaults to the build', () => {
		const established = establishRemoteConnection({
			targetStep: 'WalletConnected',
			walletOnly: true,
		});
		expect(established.deployments).toBe(deployments);
	});
});
