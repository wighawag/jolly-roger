import {chromeBar, type ChromeBar} from '$lib/core/ui/chrome';
import SendingBar from './in-flight/SendingBar.svelte';
import OfflineBanner from './offline/OfflineBanner.svelte';
import NonceCacheBanner from './nonce-cache/NonceCacheBanner.svelte';
import RpcHealthBanner from './rpc-health/RpcHealthBanner.svelte';

/**
 * THIS APP'S CHROME, top to bottom. The order of this array is the order on
 * screen.
 *
 * HERE RATHER THAN IN `core/`, unlike `layers.ts`, and the split is the point.
 * WHICH bars an app has is an app's own business: a descendant that drops the
 * nonce-cache bar or adds a "round closing in 20s" bar edits THIS file, which
 * the template touches rarely, instead of `routes/+layout.svelte`, which it
 * touches constantly. `core/ui/chrome.ts` holds only the shape, and
 * `core/ui/AppShell.svelte` holds the height contract, which is not an app's
 * business (see the note there on why the contract is deliberately not
 * replaceable).
 *
 * Adding one is one line. It renders in the flow, so the content region shrinks
 * by exactly its height and nothing goes under the fold.
 */
export const CHROME = [
	chromeBar(
		'sending',
		SendingBar,
		'A dispatch being awaited, when the app chose the in-flow placement. ' +
			'First because it is the most transient of the four, so it reads as ' +
			'the newest thing to have happened.',
	),
	chromeBar(
		'offline',
		OfflineBanner,
		'The browser reports no network. Above the RPC bars because it explains ' +
			'them: an offline device has no working RPC either, and two bars ' +
			'saying so is one bar too many (RpcHealthBanner suppresses itself ' +
			'while this one is up).',
	),
	chromeBar(
		'nonce-cache',
		NonceCacheBanner,
		'The cached nonce disagrees with the chain, so the next send would be ' +
			'rejected. A user action is needed, unlike the two around it.',
	),
	chromeBar(
		'rpc-health',
		RpcHealthBanner,
		'No RPC configured and no wallet connected, or the RPC is failing. ' +
			'Last because it is the condition a user can do least about.',
		{
			// The home page reads no onchain data, so an unhealthy RPC is not yet a
			// problem there. A route id rather than a pathname: it is base-path
			// independent, so this still works under IPFS and relative deploys.
			when: ({routeId}) => routeId !== '/',
		},
	),
] as const satisfies readonly ChromeBar[];
