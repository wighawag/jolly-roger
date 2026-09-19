import {PUBLIC_FAUCET_LINK, PUBLIC_FAUCET_API} from '$env/static/public';
import {deployments} from '$lib/deployments-store';
import {resolveURLForThisPage} from '$lib/core/env/same-host';

export {default as FaucetButton} from './FaucetButton.svelte';
export const hasFaucetLink = Boolean(
	PUBLIC_FAUCET_LINK && PUBLIC_FAUCET_LINK.trim(),
);
export const hasFaucetApi = Boolean(
	PUBLIC_FAUCET_API && PUBLIC_FAUCET_API.trim(),
);
export const hasFaucet = hasFaucetLink || hasFaucetApi;

export function getFaucetLink(address: `0x${string}`) {
	// Resolved at USE rather than at module scope: a `//:34010` faucet needs the
	// page it is running in, and this module is imported during prerender where
	// there is none. It is also a link the user clicks, so it is only ever built
	// in a browser.
	const link = resolveURLForThisPage(PUBLIC_FAUCET_LINK) ?? PUBLIC_FAUCET_LINK;
	const separator = link.includes('?') ? '&' : '?';
	return `${link}${separator}chainId=${deployments.get().chain.id}&address=${address}`;
}
