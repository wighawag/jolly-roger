import {createProcessor} from 'jolly-roger-indexer';
import {createIndexerState} from 'ethereum-indexer-browser';
import {initialContractsInfos} from '$lib/config';
import {connection, network} from '$lib/web3';
import {browser} from '$app/environment';
import type {EIP1193Provider} from 'eip-1193';
import {logs} from 'named-logs';

const namedLogger = logs('state');

export const processor = createProcessor();

/**
 * We setup the indexer and make it process the event continuously once connected to the right chain
 */
export const {state, syncing, status, init, indexToLatest, indexMore, startAutoIndexing, indexMoreAndCatchupIfNeeded} =
	createIndexerState(processor, {trackNumRequests: true});

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
				(name) => (initialContractsInfos as any).contracts[name]
			),
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
				if (!provider && connection.$state.provider) {
					provider = connection.$state.provider;
					initialize(provider);
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
