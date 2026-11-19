/**
 * WHAT THE NOTIFICATIONS STORE IS FED FROM, in this app: three small adapters
 * between `./notifications` (which names no framework and no wallet library)
 * and what the app has.
 *
 * - the ACCOUNT, from `@etherplay/connect`'s connection: the wallet's address,
 *   the origin key connect derives for this app (the local signer's key, the
 *   delegate both services check), and connect's saved publication signature
 *   when it holds one (a hosted account, which can never sign it again);
 * - the CONFIGURATION, from the public environment: the push server's API
 *   root, its VAPID key and the trigger service's origin, all three or none;
 * - the WALLET's signature over the publication message, asked through the
 *   connection's provider (`personal_sign`) when connect holds none;
 * - the WORKER's registration, once it is ready (none in dev unless the worker
 *   is enabled there, `PUBLIC_ENABLE_SW_IN_DEV`).
 */
import {derived, readable, type Readable} from 'svelte/store';
import {toHex} from 'viem';
import type {NotificationsConfig, NotifiedAccount} from './notifications';

/** The part of connect's connection state this reads. */
export type ConnectionLike =
	| {
			step: 'SignedIn';
			account: {
				address: `0x${string}`;
				signer: {privateKey: `0x${string}`};
				savedPublicKeyPublicationSignature?: `0x${string}`;
			};
	  }
	| {step: Exclude<string, 'SignedIn'>};

/**
 * The account notifications are for, ONE object per account: a connection
 * update that leaves it unchanged does not make the stores downstream check
 * the services again.
 */
export function notifiedAccount(
	connection: Readable<ConnectionLike>,
): Readable<NotifiedAccount> {
	let last: NotifiedAccount;
	return derived(connection, ($connection) => {
		if ($connection.step !== 'SignedIn' || !('account' in $connection)) {
			last = undefined;
			return last;
		}
		const {address, signer, savedPublicKeyPublicationSignature} =
			$connection.account;
		if (
			last?.address === address &&
			last.delegatePrivateKey === signer.privateKey &&
			last.ownershipSignature === savedPublicKeyPublicationSignature
		) {
			return last;
		}
		last = {
			address,
			delegatePrivateKey: signer.privateKey,
			...(savedPublicKeyPublicationSignature
				? {ownershipSignature: savedPublicKeyPublicationSignature}
				: {}),
		};
		return last;
	});
}

export type NotificationsEnv = {
	PUBLIC_PUSH_SERVER?: string;
	PUBLIC_VAPID_PUBLIC_KEY?: string;
	PUBLIC_NOTIFIER?: string;
};

const trimmed = (url: string) => url.replace(/\/+$/, '');

/**
 * The services, or undefined when any is unset (notifications are then "not
 * configured", R2), or `'off-browser'` when they are set but there is no page
 * yet (a server render or the prerender, where nothing can be subscribed and
 * the page must not say "not configured" only to flip). `domain` is the page's
 * origin: what connect's origin key and saved signature are for, and what both
 * services' configuration must name.
 */
export function notificationsConfig(
	env: NotificationsEnv,
	pageOrigin: string | undefined,
): NotificationsConfig | 'off-browser' | undefined {
	const {PUBLIC_PUSH_SERVER, PUBLIC_VAPID_PUBLIC_KEY, PUBLIC_NOTIFIER} = env;
	if (!PUBLIC_PUSH_SERVER || !PUBLIC_VAPID_PUBLIC_KEY || !PUBLIC_NOTIFIER) {
		return undefined;
	}
	if (!pageOrigin) {
		return 'off-browser';
	}
	return {
		pushServer: trimmed(PUBLIC_PUSH_SERVER),
		vapidPublicKey: PUBLIC_VAPID_PUBLIC_KEY,
		notifier: trimmed(PUBLIC_NOTIFIER),
		domain: pageOrigin,
	};
}

/** The worker's registration once ready; undefined before, and where there is none. */
export function serviceWorkerReady(
	container: Pick<ServiceWorkerContainer, 'ready'> | undefined,
): Readable<ServiceWorkerRegistration | undefined> {
	return readable<ServiceWorkerRegistration | undefined>(undefined, (set) => {
		let live = true;
		container?.ready.then((registration) => {
			if (live) set(registration);
		});
		return () => {
			live = false;
		};
	});
}

/** What `walletOwnershipSigner` needs of an EIP-1193 provider. */
export type SigningProvider = {
	request(args: {method: string; params?: unknown[]}): Promise<unknown>;
};

/**
 * The wallet signing the publication message (EIP-191, `personal_sign`), for an
 * account whose connection holds no saved signature: the one wallet prompt
 * notifications may cost, kept afterwards by `./notifications`.
 */
export function walletOwnershipSigner(provider: SigningProvider) {
	return async (address: string, message: string) =>
		(await provider.request({
			method: 'personal_sign',
			params: [toHex(message), address],
		})) as `0x${string}`;
}
