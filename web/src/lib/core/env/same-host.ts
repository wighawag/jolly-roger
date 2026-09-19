/**
 * "THE SAME HOST THIS PAGE CAME FROM", as something you can write in a `.env`.
 *
 * A dev stack serves the app and its services from one machine, and the `.env`
 * names them absolutely: `PUBLIC_NODE_URL="http://localhost:8545"`. That is
 * correct from the machine and wrong from everywhere else. Open the same dev
 * server from a phone on the LAN and the page loads, because the phone asked
 * `192.168.1.x:5173` for it, while every service inside the page still points
 * at `localhost`, which on the phone is the phone. Nothing is misconfigured
 * and nothing can be configured to fix it: one build cannot name a host that
 * depends on who is asking.
 *
 * So the value says "wherever this page came from" and the app resolves it at
 * runtime:
 *
 *   PUBLIC_NODE_URL="//:8545"          same scheme, same hostname, port 8545
 *   PUBLIC_NODE_URL="http://:8545"     force http, same hostname, port 8545
 *   PUBLIC_FAUCET_LINK="//:34010"      any service, not just the node
 *
 * THE NOTATION IS AN EMPTY HOST IN THE AUTHORITY, and it is chosen because it
 * cannot be mistaken for anything else. `new URL('http://:8545')` THROWS, so
 * an unresolved value cannot be quietly fetched, cannot be handed to a wallet
 * as a chain's rpc url, and cannot half-work: anything that reaches a URL
 * parser with one of these still in it fails loudly and immediately. A
 * placeholder that parsed (`http://HOST:8545`) would instead resolve DNS,
 * time out, and look like the service being down.
 *
 * The scheme-less form borrows protocol-relative semantics, which is the same
 * idea one level up and is what you want behind a tunnel: a page served over
 * https must not reach for an http service, because the browser will refuse it
 * as mixed content and the error will name neither this file nor the `.env`.
 * Write the scheme explicitly only when you mean to override that.
 *
 * WHAT IT DOES NOT DO. It does not map `http` to `ws`: a websocket endpoint on
 * the same host is a different scheme AND usually a different port, so it is
 * written out. It does not touch a value with a host in it, which is every
 * value in every existing `.env` in this tree, so adopting this changes
 * nothing until somebody opts in.
 */

/** Just enough of `window.location` to resolve against, so this is testable. */
export type PageOrigin = {protocol: string; hostname: string};

/**
 * `//:8545`, `http://:8545`, `//:8545/rpc` - an authority with no host.
 *
 * The port is optional (`//:` alone means "same host, default port"), and so
 * is the path, which is kept verbatim.
 */
const SAME_HOST = /^([a-z][a-z0-9+.-]*:)?\/\/:(\d+)?(\/.*)?$/i;

/** Is this value one this module has to resolve before anyone can use it? */
export function isSameHostURL(value: string | undefined): boolean {
	return !!value && SAME_HOST.test(value.trim());
}

/**
 * Resolve a configured URL against the page it is running in.
 *
 * Returns the value UNCHANGED when it is an ordinary URL, which is the case
 * for every existing configuration.
 *
 * Returns `undefined` when the value needs a page and there is none, which
 * happens during SSR and prerender. That is the honest answer rather than a
 * guess: this app prerenders its pages (ADR-0002) and there is no host to
 * follow at that moment, so the service is simply not known yet. Every consumer of
 * these values already treats "no url" as a supported state - the app then
 * reads the chain through the user's wallet - so nothing has to learn a new
 * one, and the browser resolves it for real on the first render.
 */
export function resolveSameHostURL(
	value: string | undefined,
	page: PageOrigin | undefined,
): string | undefined {
	const raw = value?.trim();
	if (!raw) return undefined;

	const match = SAME_HOST.exec(raw);
	if (!match) return raw;

	if (!page?.hostname) return undefined;

	const [, scheme, port, path] = match;
	const protocol = scheme ?? page.protocol;
	return `${protocol}//${page.hostname}${port ? `:${port}` : ''}${path ?? ''}`;
}

/**
 * The page, when there is one.
 *
 * A function rather than a constant so that nothing is read at module scope:
 * this file is imported during prerender, where `location` does not exist, and
 * a module-level read would be evaluated there.
 */
export function currentPageOrigin(): PageOrigin | undefined {
	if (typeof window === 'undefined' || !window.location) return undefined;
	const {protocol, hostname} = window.location;
	return {protocol, hostname};
}

/** `resolveSameHostURL(value, currentPageOrigin())`, which is every call site. */
export function resolveURLForThisPage(
	value: string | undefined,
): string | undefined {
	return resolveSameHostURL(value, currentPageOrigin());
}
