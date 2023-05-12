import {readable} from 'svelte/store';
import {version} from '$app/environment';

import {getParamsFromLocation, getHashParamsFromLocation} from '$lib/utils/url';
import {PUBLIC_ETH_NODE_URI_LOCALHOST, PUBLIC_ETH_NODE_URI, PUBLIC_LOCALHOST_BLOCK_TIME} from '$env/static/public';

import _contractsInfos from '$lib/blockchain/data/contracts';
export type NetworkConfig = typeof _contractsInfos;

export const initialContractsInfos = _contractsInfos;

export const globalQueryParams = ['debug', 'log', 'ethnode', '_d_eruda'];

export const hashParams = getHashParamsFromLocation();
export const {params} = getParamsFromLocation();

const chainId = initialContractsInfos.chainId as string;
let defaultRPCURL: string | undefined = params['ethnode'];

let blockTime: number | undefined = undefined;

let localDev = false;
if (chainId === '1337' || chainId === '31337') {
	localDev = true;
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

const defaultRPC = defaultRPCURL ? {chainId, url: defaultRPCURL} : undefined;

export {defaultRPC, localDev, blockTime};

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

console.log(`Jolly Roger`);

console.log({
	defaultRPC,
	localDev,
	blockTime,
	contractsInfos,
});
