/**
 * WHAT THE MESSAGING STORE IS FED FROM, in this app: two small adapters between
 * `./messaging` (which names no framework and no wallet library) and what the
 * app has. The wallet's signature is `$lib/push/sources`' `publicationSigner`,
 * shared with the notifications, so the wallet is asked once for both.
 *
 * - the CONFIGURATION, from the public environment: missiv's origin
 *   (`PUBLIC_MISSIV`), or none;
 * - the ACCOUNT, from `@etherplay/connect`'s connection: the wallet (lower
 *   case) and the key set connect derives for this app (`account.keySet`, an
 *   Ed25519 signing key and an X25519 encryption key), in missiv's shape.
 */
import {derived, type Readable} from 'svelte/store';
import type {Account} from '@missiv/client';
import type {ConnectionLike} from '$lib/push/sources';
import type {MessagingConfig} from './messaging';

export type MessagingEnv = {PUBLIC_MISSIV?: string};

/**
 * missiv's configuration, or undefined when `PUBLIC_MISSIV` is unset (messaging
 * is then "not configured", R2), or `'off-browser'` when it is set but there is
 * no page yet (a server render or the prerender). The domain is the page's host
 * and the app origin the page's origin: what connect's key set and its
 * publication signature are for.
 */
export function messagingConfig(
	env: MessagingEnv,
	pageOrigin: string | undefined,
	namespace: string,
): MessagingConfig | 'off-browser' | undefined {
	if (!env.PUBLIC_MISSIV) {
		return undefined;
	}
	if (!pageOrigin) {
		return 'off-browser';
	}
	const appOrigin = new URL(pageOrigin).origin;
	return {
		endpoint: new URL(env.PUBLIC_MISSIV).origin,
		domain: new URL(appOrigin).host,
		appOrigin,
		namespace,
	};
}

const lower = (hex: `0x${string}`) => hex.toLowerCase() as `0x${string}`;

/**
 * missiv's account, ONE object per account and key set (a connection update
 * that leaves them unchanged restarts nothing downstream); undefined unless
 * signed in. The wallet's publication signature is not carried here: it
 * reaches missiv through `register`, from `signOwnership`, so connect keeping
 * it on the account mid-registration does not restart the stores.
 */
export function messagingAccount(
	connection: Readable<ConnectionLike>,
): Readable<Account> {
	let last: Account;
	return derived(connection, ($connection) => {
		if ($connection.step !== 'SignedIn' || !('account' in $connection)) {
			last = undefined;
			return last;
		}
		const {address, keySet} = $connection.account;
		if (
			last?.address === lower(address) &&
			last.keySet.signing.privateKey === keySet.signing.privateKey
		) {
			return last;
		}
		last = {address: lower(address), keySet};
		return last;
	});
}

/**
 * Who a push says it is for, when it is missiv's: `data.missiv.recipient`
 * (missiv 0.5), for the app's own notification of a posted push
 * (`pushRecipients.readRecipientWith`, QA F23). Undefined for another push.
 */
export function missivPushRecipient(data: unknown): string | undefined {
	const recipient = (data as {missiv?: {recipient?: unknown}} | undefined)
		?.missiv?.recipient;
	return typeof recipient === 'string' ? recipient : undefined;
}
