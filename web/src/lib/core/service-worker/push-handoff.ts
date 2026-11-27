import {writable, type Readable} from 'svelte/store';

/**
 * A PUSH'S HAND-OFF IN ITS URL, READ BY THE PAGE (QA F23).
 *
 * On Safari 18.4+ (iOS and iPadOS Home Screen web apps) and 18.5+ (macOS) a
 * Declarative Web Push is shown and clicked with no JavaScript: the worker
 * gets no `push` event and no `notificationclick`, so the push's `data` never
 * reaches the app and the click only loads its `navigate` URL. A service that
 * wants the app to act on more than a URL (missiv: open the conversation) puts
 * a HAND-OFF in that URL, as the last segment of its fragment:
 * `#push-handoff=<base64url JSON>`, or `#<fragment>&push-handoff=...` when the
 * URL has a fragment already. The JSON is an object keyed by service
 * (`{missiv: {...}}`), so several services share the one reader here.
 *
 * THE FORMAT IS missiv's (its README, "Push notifications", which prints the
 * test vector `test/lib/core/service-worker/push-handoff.test.ts` pins),
 * implemented here rather than imported from `@missiv/common`: the format is
 * generic, and nothing at the root depends on missiv.
 *
 * WHAT THE APP DOES WITH IT (`src/hooks.client.ts`, `$lib/push-handoffs.ts`):
 * on load, before SvelteKit's router and the app read the URL, and on every
 * `popstate` and `hashchange` (a fragment navigation of a tab already open,
 * listened to in the capture phase, before the router's), the hand-off is
 * CONSUMED: removed from the URL with `replaceState` (keeping the path, the
 * query, `history.state` and the rest of the fragment, so a reload, a
 * bookmark or a shared link never replays it) and published. The page side of
 * the click contract (`./notification-click.ts`) publishes it as a click, in
 * the same stream as the worker's, so an app acts on a notification one way
 * whichever path it came by.
 *
 * `replaceState` here is the browser's own, called before the router starts;
 * in `vite dev` SvelteKit warns once about it.
 */

/** The fragment segment's name: `push-handoff=<base64url JSON>`. */
export const PUSH_HANDOFF_KEY = 'push-handoff';
const PREFIX = `${PUSH_HANDOFF_KEY}=`;

function toBase64Url(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
	const base64 =
		value.replace(/-/g, '+').replace(/_/g, '/') +
		'='.repeat((4 - (value.length % 4)) % 4);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

/**
 * `url` with the hand-off as the last segment of its fragment: `#push-handoff=...`
 * when it has none (a URL ending in `#` counts as none), `#<fragment>&push-handoff=...`
 * when it has one. What a service sends; here for the tests.
 */
export function withPushHandoff(url: string, handoff: object): string {
	const segment = `${PREFIX}${toBase64Url(JSON.stringify(handoff))}`;
	const hashIndex = url.indexOf('#');
	if (hashIndex === -1) {
		return `${url}#${segment}`;
	}
	if (hashIndex === url.length - 1) {
		return `${url}${segment}`;
	}
	return `${url}&${segment}`;
}

/**
 * Splits a hash (`location.hash` form: a leading `#`, or `''`) into its hand-off
 * and the rest. The hand-off is the text after the last `&` (or after the `#`
 * when there is no `&`) if it starts with `push-handoff=`; a malformed or
 * non-object one is `undefined`, never a throw. `hash` is what remains, with
 * its leading `#`, or `''` when nothing is left. A hash without a hand-off
 * comes back as it was.
 */
export function splitPushHandoff(hash: string): {
	handoff: Record<string, unknown> | undefined;
	hash: string;
} {
	if (!hash.startsWith('#')) {
		return {handoff: undefined, hash};
	}
	const separator = hash.lastIndexOf('&');
	const start = separator === -1 ? 1 : separator + 1;
	const segment = hash.slice(start);
	if (!segment.startsWith(PREFIX)) {
		return {handoff: undefined, hash};
	}
	const rest = separator === -1 ? '' : hash.slice(0, separator);
	let handoff: Record<string, unknown> | undefined;
	try {
		const value: unknown = JSON.parse(
			fromBase64Url(segment.slice(PREFIX.length)),
		);
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			handoff = value as Record<string, unknown>;
		}
	} catch {
		handoff = undefined;
	}
	return {handoff, hash: rest === '#' ? '' : rest};
}

/** A URL (absolute or not) split into its hand-off and the URL without it. */
export function splitUrlPushHandoff(url: string): {
	handoff: Record<string, unknown> | undefined;
	url: string;
} {
	const hashIndex = url.indexOf('#');
	if (hashIndex === -1) {
		return {handoff: undefined, url};
	}
	const split = splitPushHandoff(url.slice(hashIndex));
	return {handoff: split.handoff, url: url.slice(0, hashIndex) + split.hash};
}

/** What `consumePushHandoff` reads of `window.location`. */
export type PushHandoffLocation = {
	pathname: string;
	search: string;
	hash: string;
};
/** What `consumePushHandoff` uses of `window.history`. */
export type PushHandoffHistory = {
	state: unknown;
	replaceState(state: unknown, unused: string, url: string): void;
};

/**
 * Reads the current URL's hand-off and, when there is one, removes it at once
 * (`replaceState`, keeping the path, the query, `history.state` and the rest
 * of the fragment). A malformed hand-off is removed too, and gives
 * `undefined`; no hand-off, nothing done.
 */
export function consumePushHandoff(
	location: PushHandoffLocation,
	history: PushHandoffHistory,
): Record<string, unknown> | undefined {
	const split = splitPushHandoff(location.hash);
	if (split.hash === location.hash) {
		return undefined;
	}
	history.replaceState(
		history.state,
		'',
		location.pathname + location.search + split.hash,
	);
	return split.handoff;
}

/** A hand-off the page read from its URL: the URL is the page's, without it. */
export type PushHandoffRead = {
	id: number;
	url: string;
	handoff: Record<string, unknown>;
};

/** The latest hand-off the page read, undefined before any; told apart by `id`. */
export type PushHandoffs = Readable<PushHandoffRead | undefined>;

/** The window `install` listens on. */
export type HandoffWindow = {
	location: PushHandoffLocation & {href: string};
	history: PushHandoffHistory;
	addEventListener(
		type: 'popstate' | 'hashchange',
		listener: () => void,
		options: {capture: boolean},
	): void;
	removeEventListener(
		type: 'popstate' | 'hashchange',
		listener: () => void,
		options: {capture: boolean},
	): void;
};

/** The hand-offs of the page's URL, as it reads them. */
export function createPushHandoffs() {
	let lastId = 0;
	const store = writable<PushHandoffRead | undefined>(undefined);

	/** Consume the hand-off of `target`'s URL, if any, and publish it. */
	function consume(target: Pick<HandoffWindow, 'location' | 'history'>) {
		const handoff = consumePushHandoff(target.location, target.history);
		if (handoff) {
			store.set({id: ++lastId, url: target.location.href, handoff});
		}
	}

	/**
	 * Consume now and on every `popstate` and `hashchange`, in the capture
	 * phase. Call it before the router starts. Returns the removal.
	 */
	function install(target: HandoffWindow): () => void {
		const listener = () => consume(target);
		consume(target);
		target.addEventListener('popstate', listener, {capture: true});
		target.addEventListener('hashchange', listener, {capture: true});
		return () => {
			target.removeEventListener('popstate', listener, {capture: true});
			target.removeEventListener('hashchange', listener, {capture: true});
		};
	}

	return {
		reads: {subscribe: store.subscribe} as PushHandoffs,
		consume,
		install,
	};
}
