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
 * - the WALLET's signature over the publication message, when the account
 *   carries none: connect's `getSignatureForPublicKeyPublication`, which asks a
 *   wallet at most once per account and origin key and keeps the answer;
 * - the WORKER's registration, once it is ready, or why there will be none
 *   (none in dev unless the worker is enabled there, `PUBLIC_ENABLE_SW_IN_DEV`),
 *   so the page can say so rather than ask to sign in (QA F13).
 */
import {derived, get, readable, type Readable} from 'svelte/store';
import {originPublicKeyPublicationMessage} from 'delegated-identity';
import type {ServiceWorkerState} from '$lib/core/service-worker';
import type {
	NotificationsConfig,
	NotifiedAccount,
	PushServiceWorker,
} from './notifications';

/** The part of connect's connection state this reads. */
export type ConnectionLike =
	| {
			step: 'SignedIn';
			account: {
				address: `0x${string}`;
				signer: {
					origin: string;
					publicKey: `0x${string}`;
					privateKey: `0x${string}`;
				};
				savedPublicKeyPublicationSignature?: `0x${string}`;
			};
	  }
	| {step: Exclude<string, 'SignedIn'>};

/**
 * The account notifications are for, ONE object per account and origin key: a
 * connection update that leaves them unchanged does not make the stores
 * downstream check the services again. That includes connect keeping the
 * wallet's publication signature on the account (0.18) DURING an `enable()`:
 * a new object then would make the push client re-check mid-action. The object
 * keeps the signature it was made with, and a later ask goes through connect,
 * which answers from what it kept; a page load reads it from the start.
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
			last.delegatePrivateKey === signer.privateKey
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

/**
 * The app's worker for the push half: its registration once ready, or why none
 * will come. `registers` is whether this page registers the worker at all (the
 * rule is `src/routes/+layout.ts`'s: always, but in dev only with
 * `PUBLIC_ENABLE_SW_IN_DEV=true`), so `false` is `'off-in-dev'`; `state` is the
 * app's `serviceWorker` store (`$lib`), whose failed or skipped registration is
 * `'unavailable'`. Anything else waits for `ready`, which never settles where no
 * worker registers: that wait is what read as "sign in" in dev.
 */
export function pushServiceWorker(params: {
	registers: boolean;
	state: Readable<ServiceWorkerState>;
	container: Pick<ServiceWorkerContainer, 'ready'> | undefined;
}): Readable<PushServiceWorker> {
	if (!params.registers) {
		return readable<PushServiceWorker>('off-in-dev');
	}
	return derived(
		[params.state, serviceWorkerReady(params.container)] as const,
		([$state, $ready]): PushServiceWorker => {
			if ($ready) return $ready;
			if ($state && ('error' in $state || 'skipped' in $state)) {
				return 'unavailable';
			}
			return undefined;
		},
	);
}

/** What `publicationSigner` needs of connect's connection store. */
export type PublicationSigning = Readable<ConnectionLike> & {
	getSignatureForPublicKeyPublication(): Promise<`0x${string}`>;
};

/**
 * The publication signature, from `@etherplay/connect` (its
 * `getSignatureForPublicKeyPublication`): a hosted account's saved one, or the
 * wallet asked at most once per account and origin key, kept on the account.
 * Connect signs for ITS signing origin and key, so this refuses a message that
 * is not that one (the app's domain must be connect's signing origin: the
 * page's, unless the app sets `signingOrigin`) or an account that is not the
 * one signed in, rather than hand a service a signature it will refuse.
 */
export function publicationSigner(connection: PublicationSigning) {
	return async (address: string, message: string) => {
		const $connection = get(connection);
		if (
			$connection.step !== 'SignedIn' ||
			!('account' in $connection) ||
			$connection.account.address.toLowerCase() !== address.toLowerCase()
		) {
			throw new Error(`${address} is not the account signed in`);
		}
		const {origin, publicKey} = $connection.account.signer;
		if (originPublicKeyPublicationMessage(origin, publicKey) !== message) {
			throw new Error(
				`the publication message asked for is not the one the connection signs: is the app's domain connect's signing origin (${origin})?`,
			);
		}
		return connection.getSignatureForPublicKeyPublication();
	};
}
