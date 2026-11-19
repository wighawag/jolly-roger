/**
 * "NOTIFY ME", BOTH HALVES OF IT, AS ONE STORE.
 *
 * A push reaches an account only when two services agree to it:
 *
 * - push-notification-server holds THIS DEVICE's Web Push subscription for the
 *   account (`/register`), which @push-notification/client does: it asks the
 *   browser for a subscription against the server's VAPID key and registers
 *   it, signed by the app's delegate key and proven by the wallet's ownership
 *   signature (delegated-identity);
 * - the trigger service (etherfold's, `@etherfold/platform-nodejs-triggers`)
 *   holds the account's TRIGGER (`/subscriptions`, a `kind` the operator
 *   declared, such as "a new greeting from anyone but me"), which this module
 *   registers itself with the same identity: the same delegate key and the same
 *   ownership signature, signed for the trigger service's origin.
 *
 * So the wallet is asked once, at most, and that is connect's to ensure: the
 * ownership signature is the account's `savedPublicKeyPublicationSignature`
 * (a hosted account's from sign-in; a wallet's once it answered, which
 * `@etherplay/connect` 0.18 keeps on the persisted account), else
 * `signOwnership` (connect's `getSignatureForPublicKeyPublication`) is asked,
 * and connect keeps what the wallet answers, for the trigger registration, its
 * renewal on every later load and `disable()`. Nothing is cached here.
 *
 * A trigger expires unless renewed (etherfold ADR-0012), so on load, once the
 * device is known to be registered, the trigger is registered again (which
 * renews it, or re-creates it if it expired), but only with a signature already
 * at hand: a page load never prompts the wallet.
 *
 * With no `config` (either service unset, R2 of the service-layers spec), the
 * store is `{status: 'not-configured'}` and its actions do nothing; off the
 * browser it is `loading`, for the page the browser then renders.
 *
 * Svelte-store-compatible, and works only while subscribed, as the push client
 * it wraps.
 */
import {derived, get, readable, writable, type Readable} from 'svelte/store';
import {
	createPushNotifications,
	type PushStatus,
} from '@push-notification/client';
import {
	delegatePublicKey,
	fromDomainToOrigin,
	originPublicKeyPublicationMessage,
	REQUEST_SIGNATURE_HEADER,
	signRequest,
} from 'delegated-identity';

export type NotificationsConfig = {
	/** push-notification-server's API root, e.g. `https://push.example/api` */
	pushServer: string;
	/** its VAPID public key (base64url) */
	vapidPublicKey: string;
	/** the trigger service's public ORIGIN (its API is served at its root) */
	notifier: string;
	/** this app, as both services' configuration names it: a bare host or an origin */
	domain: string;
};

/** The account notifications are addressed to (the wallet), and the app's delegate key for it. */
export type NotifiedAccount =
	| {
			address: `0x${string}`;
			delegatePrivateKey: `0x${string}`;
			/** the wallet's signature over the publication message, when the app holds it */
			ownershipSignature?: `0x${string}`;
	  }
	| undefined;

/**
 * Whether the account's trigger is registered: `unknown` until checked (or when
 * checking it would need a prompt), `checking` while it is renewed on load.
 */
export type TriggerStatus = 'unknown' | 'checking' | 'on' | 'off';

export type NotificationsState =
	| {status: 'not-configured'}
	| {
			/** the device's, as @push-notification/client reports it */
			status: PushStatus;
			trigger: TriggerStatus;
			/** an action (enable, disable) is running */
			busy: boolean;
			/** the last failure, until acknowledged */
			error?: unknown;
	  };

export type Notifications = Readable<NotificationsState> & {
	/** Registers this device and the trigger (may prompt for permission, and once for the wallet's signature). */
	enable(): Promise<void>;
	/** Cancels the trigger and unregisters this device for the account. */
	disable(): Promise<void>;
	acknowledgeError(): void;
};

export type NotificationsOptions = {
	/**
	 * undefined when either service is not configured; `'off-browser'` when they
	 * are but there is no page to subscribe (a server render), shown as loading
	 */
	config: NotificationsConfig | 'off-browser' | undefined;
	/** the trigger service's subscription kind this toggle registers */
	kind: string;
	account: Readable<NotifiedAccount>;
	serviceWorker: Readable<ServiceWorkerRegistration | undefined>;
	/**
	 * The wallet's signature over the publication message, when the account
	 * carries none: `@etherplay/connect`'s `getSignatureForPublicKeyPublication`,
	 * which asks a wallet at most once per account and origin key (0.18) and
	 * keeps the answer on the account.
	 */
	signOwnership: (address: string, message: string) => Promise<`0x${string}`>;
	fetch?: typeof fetch;
	permission?: () => NotificationPermission | undefined;
	supported?: () => boolean;
};

export function createNotifications(
	options: NotificationsOptions,
): Notifications {
	const config = options.config;
	if (!config || config === 'off-browser') {
		const state = readable<NotificationsState>(
			config
				? {status: 'loading', trigger: 'unknown', busy: false}
				: {status: 'not-configured'},
		);
		return {
			subscribe: state.subscribe,
			enable: async () => {},
			disable: async () => {},
			acknowledgeError() {},
		};
	}

	// narrowed, for the closures below
	const services: NotificationsConfig = config;
	const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
	const appOrigin = fromDomainToOrigin(config.domain);

	function publicationOf(of: NonNullable<NotifiedAccount>) {
		return originPublicKeyPublicationMessage(
			appOrigin,
			delegatePublicKey(of.delegatePrivateKey),
		);
	}
	/** The signature at hand, the wallet NOT asked: the account's own. */
	function knownOwnership(of: NonNullable<NotifiedAccount>) {
		return of.ownershipSignature;
	}
	/** The account's own signature, or the signer's (which asks the wallet at most once). */
	async function ownershipOf(of: NonNullable<NotifiedAccount>) {
		return (
			of.ownershipSignature ??
			(await options.signOwnership(of.address, publicationOf(of)))
		);
	}

	const push = createPushNotifications({
		serverEndpoint: config.pushServer,
		vapidPublicKey: config.vapidPublicKey,
		domain: config.domain,
		account: options.account,
		serviceWorker: options.serviceWorker,
		signOwnership: options.signOwnership,
		fetch: doFetch,
		permission: options.permission,
		supported: options.supported,
	});

	// about ONE account: shown as `unknown` once the account is another
	type TriggerState = {
		of: NotifiedAccount;
		trigger: TriggerStatus;
		busy: boolean;
		error?: unknown;
	};
	const trigger = writable<TriggerState>({
		of: undefined,
		trigger: 'unknown',
		busy: false,
	});

	async function postTrigger(
		route: 'subscriptions' | 'subscriptions/cancel',
		of: NonNullable<NotifiedAccount>,
		ownershipSignature: `0x${string}`,
	) {
		const url = new URL(`${services.notifier}/${route}`);
		const body = JSON.stringify({
			address: of.address,
			domain: services.domain,
			ownershipSignature,
			kind: options.kind,
		});
		const signature = await signRequest(
			{serverOrigin: url.origin, method: 'POST', path: url.pathname, body},
			of.delegatePrivateKey,
		);
		const response = await doFetch(url.toString(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				[REQUEST_SIGNATURE_HEADER]: signature,
			},
			body,
		});
		if (!response.ok) {
			throw new Error(
				`the trigger service refused ${route} (${response.status}): ${await response.text()}`,
			);
		}
	}

	let account: NotifiedAccount; // the latest, as the store last saw it
	// the account whose trigger was registered or renewed since it was loaded
	let renewedFor: NotifiedAccount;
	// an enable or disable is running: the load's renewal stays out of its way
	let acting = false;
	// the account a renewal was scheduled for, until it reports
	let renewing: NotifiedAccount;

	async function renew(of: NonNullable<NotifiedAccount>) {
		const signature = knownOwnership(of);
		if (!signature) {
			return; // it would need a prompt: left `unknown`
		}
		renewing = undefined;
		trigger.set({of, trigger: 'checking', busy: false});
		try {
			await postTrigger('subscriptions', of, signature);
			trigger.set({of, trigger: 'on', busy: false});
		} catch (error) {
			trigger.set({of, trigger: 'off', busy: false, error});
		}
	}

	const store = derived(
		[options.account, push, trigger] as const,
		([$account, $push, $trigger], set) => {
			account = $account;
			if (
				$account &&
				$push.status === 'on' &&
				!$push.busy &&
				!acting &&
				renewedFor !== $account
			) {
				renewedFor = $account;
				if (knownOwnership($account)) {
					renewing = $account;
					// not from inside the derived store's own update
					queueMicrotask(() => void renew($account));
				}
			}
			const mine: Omit<TriggerState, 'of'> =
				$trigger.of === $account
					? $trigger
					: {
							// a renewal about to start shows as one, so nobody reads `unknown` as settled
							trigger: renewing === $account ? 'checking' : 'unknown',
							busy: false,
						};
			set({
				status: $push.status,
				trigger: mine.trigger,
				busy: $push.busy || mine.busy,
				error: mine.error ?? $push.error,
			});
		},
		{status: 'loading', trigger: 'unknown', busy: false} as NotificationsState,
	);

	return {
		subscribe: store.subscribe,

		async enable() {
			const of = account;
			if (!of) return;
			acting = true;
			renewedFor = of;
			try {
				await push.enable();
				const device = get(push);
				if (device.status !== 'on' || device.error) {
					return; // the push client reports why
				}
				trigger.set({of, trigger: 'unknown', busy: true});
				try {
					await postTrigger('subscriptions', of, await ownershipOf(of));
					trigger.set({of, trigger: 'on', busy: false});
				} catch (error) {
					trigger.set({of, trigger: 'off', busy: false, error});
				}
			} finally {
				acting = false;
			}
		},

		async disable() {
			const of = account;
			if (!of) return;
			acting = true;
			let error: unknown;
			const before = get(trigger);
			trigger.set({
				of,
				trigger: before.of === of ? before.trigger : 'unknown',
				busy: true,
			});
			try {
				await postTrigger('subscriptions/cancel', of, await ownershipOf(of));
			} catch (refused) {
				error = refused;
			}
			try {
				await push.disable();
			} finally {
				trigger.set({
					of,
					trigger: error ? 'unknown' : 'off',
					busy: false,
					error,
				});
				acting = false;
			}
		},

		acknowledgeError() {
			push.acknowledgeError();
			trigger.update((state) => ({...state, error: undefined}));
		},
	};
}
