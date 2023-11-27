import {readable} from 'svelte/store';
import {version} from '$app/environment';

import {getParamsFromLocation, getHashParamsFromLocation} from '$lib/utils/url';
import {
	PUBLIC_ETH_NODE_URI_LOCALHOST,
	PUBLIC_ETH_NODE_URI,
	PUBLIC_LOCALHOST_BLOCK_TIME,
	PUBLIC_DEV_NODE_URI,
} from '$env/static/public';

import {env} from '$env/dynamic/public';

import _contractsInfos from '$data/contracts';
export type NetworkConfig = typeof _contractsInfos;

export const initialContractsInfos = _contractsInfos;

export const globalQueryParams = ['debug', 'log', 'ethnode', '_d_eruda'];

export const hashParams = getHashParamsFromLocation();
export const {params} = getParamsFromLocation();

const contractsChainId = initialContractsInfos.chainId as string;
let defaultRPCURL: string | undefined = params['ethnode'];

let blockTime: number | undefined = undefined;

let isUsingLocalDevNetwork = false;
if (contractsChainId === '1337' || contractsChainId === '31337') {
	isUsingLocalDevNetwork = true;
	if (!defaultRPCURL) {
		const url = PUBLIC_ETH_NODE_URI_LOCALHOST as string;
		if (url && url !== '') {
			defaultRPCURL = url;
		}
	}
	blockTime = PUBLIC_LOCALHOST_BLOCK_TIME ? parseInt(PUBLIC_LOCALHOST_BLOCK_TIME) : undefined;
}
if (!defaultRPCURL) {
	const url = PUBLIC_ETH_NODE_URI as string;
	if (url && url !== '') {
		defaultRPCURL = url;
	}
}

const localRPC =
	isUsingLocalDevNetwork && PUBLIC_DEV_NODE_URI ? {chainId: contractsChainId, url: PUBLIC_DEV_NODE_URI} : undefined;

const defaultRPC = defaultRPCURL ? {chainId: contractsChainId, url: defaultRPCURL} : undefined;

// This allow to debug what is written to local storage
// Disable this if the data should remains private
export const doNotEncryptLocally = true;

export {defaultRPC, isUsingLocalDevNetwork, localRPC, blockTime, env};

let _setContractsInfos: any;
export const contractsInfos = readable<NetworkConfig>(_contractsInfos, (set) => {
	_setContractsInfos = set;
});

export function _asNewModule(set: any) {
	_setContractsInfos = set;
}

if (import.meta.hot) {
	import.meta.hot.accept((newModule) => {
		newModule?._asNewModule(_setContractsInfos);
		_setContractsInfos(newModule?.initialContractsInfos);
	});
}

console.log(`VERSION: ${version}`);
