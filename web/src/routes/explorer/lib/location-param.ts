import {derived, type Readable} from 'svelte/store';
import type {NavigationService} from '$lib/core/navigation';

/**
 * Extract a hex (0x...) parameter for an explorer page from a location,
 * supporting both IPFS gateway styles:
 * 1. URL hash (`#0x123`) - path-based IPFS gateways.
 * 2. URL pathname (`/explorer/<segment>/0x123`) - unique-origin IPFS with a
 *    `_redirects` rewrite.
 *
 * Pure: takes the hash/pathname explicitly so it can be unit tested.
 */
export function extractHexParam(
	pathSegment: string,
	location: {hash: string; pathname: string},
): `0x${string}` | null {
	const urlHash = location.hash.slice(1);
	if (urlHash && urlHash.startsWith('0x')) {
		return urlHash as `0x${string}`;
	}

	const pattern = new RegExp(`/explorer/${pathSegment}/(0x[a-fA-F0-9]+)`);
	const match = location.pathname.match(pattern);
	if (match && match[1]) {
		return match[1] as `0x${string}`;
	}

	return null;
}

/**
 * Readable store of a hex explorer param (address / tx hash) read from the URL.
 *
 * Derived from the app's navigation service rather than from its own
 * `hashchange`/`popstate` listeners. This page reads the URL for a reason the
 * router cannot serve: on a path-based IPFS gateway the value arrives in the
 * FRAGMENT (`/explorer/tx/#0x…`, see `core/utils/web/path.ts`), which is not a
 * route change. The navigation service already merges that world with the
 * router's, so there is one answer to "where are we" instead of two subscribing
 * to the same events separately.
 *
 * `undefined` (the service before it attaches, during SSR and until hydration)
 * reads as "no param yet", which is what the page shows anyway.
 *
 * @param pathSegment the explorer segment, e.g. 'address' or 'tx'.
 */
export function createHexLocationParamStore(
	navigation: NavigationService,
	pathSegment: string,
): Readable<`0x${string}` | null> {
	return derived(navigation, (location) =>
		location
			? extractHexParam(pathSegment, {
					hash: location.url.hash,
					pathname: location.url.pathname,
				})
			: null,
	);
}
