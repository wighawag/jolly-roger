import {describe, it, expect, vi, afterEach} from 'vitest';
import {TARGET_STEP} from '$lib/core/connection/mode';

/**
 * WHAT BROADCASTS FOLLOWS THE CONNECTION, NOT THE APP'S CONFIGURATION.
 *
 * The app offers its node url (`PUBLIC_NODE_URL`, resolved against the page)
 * TO the connection factory, and the factory reports what it actually used
 * (`EstablishedConnection.nodeURL`). A world on another chain (an embedded one,
 * reachable only through its provider) uses none. The local signer's transport
 * and the payment rail are then built from the connection's url, so they fall
 * back to its provider, rather than broadcasting a world's transactions to the
 * app's node: a chain the world's keys have never been on.
 *
 * Found in template-commit-reveal (1126f860, its finding
 * `a-worlds-signer-broadcast-to-the-apps-node`), where it needed a configured
 * url, a local signer and a world that is not the app's. This branch is where
 * the three meet, and nothing else pinned it: without a `PUBLIC_NODE_URL` (a
 * dev run) the app has no url either and the right branch is taken anyway.
 *
 * OBSERVED AT THE TWO SEAMS rather than through a sent transaction. The signer
 * client is built lazily inside a store over the connection, and off-browser
 * the connection never leaves `Idle` (see `signer-client-guard.test.ts`), so
 * what is checked is the url each consumer is handed: `resolveSignerRpc`'s,
 * from which the signer's transport is `http(url)` or the connection's
 * provider, and `createPaymentRail`'s.
 *
 * `$env/static/public` is inlined at build time, so the url is set by mocking
 * the module, as `fatal.test.ts` does.
 */

const APP_NODE_URL = 'http://app-node.example:8545';

afterEach(() => {
	vi.resetModules();
	vi.doUnmock('$env/static/public');
	vi.doUnmock('$lib/core/connection/signer-rpc.js');
	vi.doUnmock('$lib/core/connection/remote.js');
});

// See `fatal.test.ts`: the first case pays for importing the whole context
// graph. A hang guard, not a budget.
const IMPORT_TIMEOUT = 120_000;

async function loadWithSpies() {
	vi.resetModules();
	vi.doMock('$env/static/public', () => ({
		PUBLIC_NODE_URL: APP_NODE_URL,
		PUBLIC_CHAIN_INFO_NODE_URL: '',
		PUBLIC_WALLET_HOST: '',
		PUBLIC_USE_BURNER_WALLET: '',
		PUBLIC_OPERATION_RETENTION_DAYS: '',
		PUBLIC_ENS_NODE_URL: '',
		PUBLIC_ENABLE_SW_IN_DEV: '',
		PUBLIC_FAUCET_LINK: '',
		PUBLIC_FAUCET_API: '',
	}));

	const signerRpcUrls: (string | undefined)[] = [];
	vi.doMock('$lib/core/connection/signer-rpc.js', async (importOriginal) => {
		const actual =
			await importOriginal<typeof import('$lib/core/connection/signer-rpc')>();
		return {
			...actual,
			resolveSignerRpc: (
				...args: Parameters<typeof actual.resolveSignerRpc>
			) => {
				signerRpcUrls.push(args[1]);
				return actual.resolveSignerRpc(...args);
			},
		};
	});

	const railUrls: (string | undefined)[] = [];
	vi.doMock('$lib/core/connection/remote.js', async (importOriginal) => {
		const actual =
			await importOriginal<typeof import('$lib/core/connection/remote')>();
		return {
			...actual,
			createPaymentRail: (
				...args: Parameters<typeof actual.createPaymentRail>
			) => {
				railUrls.push(args[1]?.nodeURL);
				return actual.createPaymentRail(...args);
			},
		};
	});

	const {createContext} = await import('$lib/context/index');
	const {establishRemoteConnection} =
		await import('$lib/core/connection/remote.js');
	return {createContext, establishRemoteConnection, signerRpcUrls, railUrls};
}

// Only meaningful where the app signs in: with no local signer there is no
// signer transport to point anywhere. Guarded explicitly, as `fatal.test.ts`
// does, so flipping the constant does not quietly drop the coverage.
describe.runIf(TARGET_STEP === 'SignedIn')('a world off the app’s node', () => {
	it(
		'the local signer and the payment rail use the connection’s provider',
		async () => {
			const {
				createContext,
				establishRemoteConnection,
				signerRpcUrls,
				railUrls,
			} = await loadWithSpies();

			// A factory on another chain: it was offered the app's url and did not
			// take it, as an embedded world does not.
			createContext({
				establishConnection: (request) => {
					expect(request.nodeURL).toBe(APP_NODE_URL);
					return {...establishRemoteConnection(request), nodeURL: undefined};
				},
			});

			expect(signerRpcUrls).toEqual([undefined]);
			expect(railUrls).toEqual([undefined]);
		},
		IMPORT_TIMEOUT,
	);

	it(
		'and use the app’s node when the connection took it',
		async () => {
			const {createContext, signerRpcUrls, railUrls} = await loadWithSpies();

			// The remote world, which reports the url it was given.
			createContext();

			expect(signerRpcUrls).toEqual([APP_NODE_URL]);
			expect(railUrls).toEqual([APP_NODE_URL]);
		},
		IMPORT_TIMEOUT,
	);
});
