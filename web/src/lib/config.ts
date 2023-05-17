import {readable} from 'svelte/store';
import {version} from '$app/environment';

import {getParamsFromLocation, getHashParamsFromLocation} from '$lib/utils/url';
import {
	PUBLIC_ETH_NODE_URI_LOCALHOST,
	PUBLIC_ETH_NODE_URI,
	PUBLIC_LOCALHOST_BLOCK_TIME,
	PUBLIC_DEV_NODE_URI,
} from '$env/static/public';

import _contractsInfos from '$lib/blockchain/data/contracts';
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

export {defaultRPC, isUsingLocalDevNetwork, localRPC, blockTime};

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
	localRPC,
	defaultRPC,
	isUsingLocalDevNetwork,
	blockTime,
	contractsInfos,
});

// Debugging vite initial reload
// const observeUrlChange = () => {
// 	console.log(`observing...`);
// 	let oldHref = document.location.href;
// 	const body = document.querySelector('body');
// 	if (body) {
// 		const observer = new MutationObserver((mutations) => {
// 			mutations.forEach(() => {
// 				if (oldHref !== document.location.href) {
// 					oldHref = document.location.href;
// 					/* Changed ! your code here */
// 				}
// 			});
// 		});
// 		observer.observe(body, {childList: true, subtree: true});
// 	}
// 	window.addEventListener('popstate', (event) => {
// 		console.log(`popstate`, event);
// 	});

// 	const oldPushState = window.history.pushState.bind(window.history);
// 	window.history.pushState = (data, unused, url) => {
// 		console.log(`pushState`, JSON.stringify({data, unused, url}, null, 2));
// 		oldPushState(data, unused, url);
// 	};
// 	// const oldReload = window.location.reload.bind(window.location);
// 	// window.location.reload = () => {
// 	// 	console.log(`reload`);
// 	// 	oldReload();
// 	// };
// 	// const oldReplace = window.location.replace.bind(window.location);
// 	// window.location.replace = (url) => {
// 	// 	console.log(`replace`, url);
// 	// 	oldReplace(url);
// 	// };
// 	window.onbeforeunload = function (ev) {
// 		console.log(ev, JSON.stringify(ev, null, 2));
// 		// return 'Are you sure you want to navigate away?';
// 		return false;
// 	};
// };

// if (typeof window !== 'undefined') {
// 	console.log(`WINDOW`);
// 	// window.addEventListener('load', observeUrlChange);
// 	observeUrlChange();
// }
