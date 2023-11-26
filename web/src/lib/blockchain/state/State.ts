import {createProcessor} from 'jolly-roger-indexer';
import {createIndexerState, keepStateOnIndexedDB} from 'ethereum-indexer-browser';
import {initialContractsInfos} from '$lib/config';
import {connection, network} from '$lib/web3';
import {browser} from '$app/environment';
import type {EIP1193Provider} from 'eip-1193';
import {logs} from 'named-logs';
import {url} from '$lib/utils/path';

const namedLogger = logs('state');

export const processor = createProcessor();

const remoteIndexedState = url(`/indexed-state-${initialContractsInfos.name}.json`);
/**
 * We setup the indexer and make it process the event continuously once connected to the right chain
 */
export const {
	state,
	syncing,
	status,
	init,
	reset: resetIndexer,
	indexToLatest,
	indexMore,
	startAutoIndexing,
	indexMoreAndCatchupIfNeeded,
} = createIndexerState(processor, {
	trackNumRequests: true,
	// logRequests: true,
	keepState: keepStateOnIndexedDB('jolly-roger', remoteIndexedState) as any, // TODO types
});

async function indexIfNotIndexing() {
	await indexMoreAndCatchupIfNeeded();
}

async function indexContinuously(provider: EIP1193Provider) {
	indexIfNotIndexing();
	connection.onNewBlock(() => {
		if (network.$state.chainId === initialContractsInfos.chainId) {
			indexIfNotIndexing();
		}
	});
}

function initialize(provider: EIP1193Provider) {
	init({
		provider,
		source: {
			chainId: initialContractsInfos.chainId,
			contracts: Object.keys(initialContractsInfos.contracts).map(
				(name) => (initialContractsInfos as any).contracts[name],
			),
			genesisHash: initialContractsInfos.genesisHash,
		},
		config: {
			logLevel: 1,
		},
	}).then((v) => {
		namedLogger.log(`initialised`, v);
		indexContinuously(provider);
	});
}

let provider: EIP1193Provider | undefined;
if (browser) {
	network.subscribe(($network) => {
		if ($network.chainId === initialContractsInfos.chainId) {
			try {
				if (!provider && connection.$state.provider !== undefined) {
					provider = connection.$state.provider;
					initialize(connection.$state.provider);
				}
			} catch (err) {
				console.error(`caught exception `, err);
			}
		}
	});
}

export function stringify(v: any) {
	return JSON.stringify(v, (k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v), 2);
}

if (typeof window !== 'undefined') {
	(window as any).state = state;
	(window as any).status = status;
	(window as any).syncing = syncing;
}
