/**
 * "NOTIFY ME", BOTH HALVES OF IT, AS ONE STORE.
 *
 * A push reaches an account only when two services agree to it:
 *
 * - push-notification-server holds THIS DEVICE's Web Push subscription for the
 *   account (`/register`), which @push-notification/client does: it asks the
 *   browser for a subscription against the server's VAPID key and registers
 *   it, signed by the account's Ed25519 signing key (its key set in the app,
 *   which connect derives) and proven by the wallet's ownership signature over
 *   that key set (delegated-identity 0.2);
 * - the trigger service (etherfold's, `@etherfold/platform-nodejs-triggers`)
 *   holds the account's TRIGGER (`/subscriptions`, a `kind` the operator
 *   declared, such as "a new greeting from anyone but me"), which this module
 *   registers itself with the same identity: the same key set and the same
 *   ownership signature, signed for the trigger service's origin.
 *
 * So the wallet is asked once, at most, and that is connect's to ensure: the
 * ownership signature is the account's `savedPublicKeyPublicationSignature`
 * (a hosted account's from sign-in; a wallet's once it answered, which
 * `@etherplay/connect` keeps on the persisted account), else
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
 * WHAT STANDS IN THE WAY, said apart (QA F13). The push client reports
 * `no-account` both for no account and for no service-worker registration
 * yet, and the page used to read both as "sign in". So: no account is
 * `no-account`, with `signIn()` to get one from the line itself; an account
 * on a page that will register no worker (vite dev, or a registration that
 * failed) is `no-worker`, with the reason in `worker`; an account whose worker
 * may still come is `loading`.
 *
 * ONE ACCOUNT PER DEVICE (QA F21), when the app asks for it
 * (`replaceOtherAccounts`, this app's composition does): push-notification-server
 * keys a device by (account, app, endpoint), so one browser can be registered
 * for several accounts of the app and then receives every one's pushes,
 * direct messages it cannot read included. With the option, enabling makes
 * the device the current account's alone: the server removes its registrations
 * for the app's other accounts in the same transaction. Either way the state
 * names, in `otherAccounts`, the other accounts this device is registered for,
 * so the line can say "this device is notified for 0x..." and `switchHere()`
 * moves it to the current account.
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
	fromDomainToOrigin,
	originPublicKeyPublicationMessage,
	REQUEST_SIGNATURE_HEADER,
	signRequest,
	type KeySet,
} from 'delegated-identity';

export type NotificationsConfig = {
	/** push-notification-server's API root, e.g. `https://push.example/api` */
	pushServer: string;
	/** its VAPID public key (base64url) */
	vapidPublicKey: string;
	/**
	 * the API root of this app at the trigger service: its public origin and
	 * the app's prefix, e.g. `https://triggers.example/greetings` (one service
	 * hosts several apps, each at `/{app}/`, @etherfold/triggers 0.3)
	 */
	notifier: string;
	/** this app, as both services' configuration names it: a bare host or an origin */
	domain: string;
};

/** The account notifications are addressed to (the wallet), and its key set in the app. */
export type NotifiedAccount =
	| {
			address: `0x${string}`;
			/**
			 * the account's key set in this app (connect's `account.keySet`): its
			 * Ed25519 signing key signs each request, and only the two public keys
			 * are sent
			 */
			keySet: KeySet;
			/** the wallet's signature over the publication message, when the app holds it */
			ownershipSignature?: `0x${string}`;
	  }
	| undefined;

/**
 * Whether the account's trigger is registered: `unknown` until checked (or when
 * checking it would need a prompt), `checking` while it is renewed on load.
 */
export type TriggerStatus = 'unknown' | 'checking' | 'on' | 'off';

/**
 * The app's service worker, as the push half needs it: its registration once
 * ready, `undefined` while it may still come, or why none will come:
 * `'off-in-dev'` when the page registers none (vite dev, unless
 * `PUBLIC_ENABLE_SW_IN_DEV=true`), `'failed-in-dev'` when it tried in dev and
 * failed (dev registers a MODULE worker, which only Chromium runs: Firefox
 * refuses it), `'unavailable'` when it tried and failed or stood aside.
 */
export type PushServiceWorker =
	ServiceWorkerRegistration | WorkerAbsence | undefined;
export type WorkerAbsence = 'off-in-dev' | 'failed-in-dev' | 'unavailable';

export type NotificationsState =
	| {status: 'not-configured'}
	| {
			/**
			 * the device's, as @push-notification/client reports it, except that
			 * `no-account` means no account here, and `no-worker` an account on a
			 * page with no service worker to subscribe
			 */
			status: PushStatus | 'no-worker';
			/** with `no-worker`: why there is none */
			worker?: WorkerAbsence;
			trigger: TriggerStatus;
			/** an action (enable, disable) is running */
			busy: boolean;
			/** the last failure, until acknowledged */
			error?: unknown;
			/**
			 * the OTHER accounts (lowercased) this device is registered for in the
			 * app; undefined while unknown (from @push-notification/client 0.2)
			 */
			otherAccounts?: string[];
	  };

export type Notifications = Readable<NotificationsState> & {
	/** Registers this device and the trigger (may prompt for permission, and once for the wallet's signature). */
	enable(): Promise<void>;
	/**
	 * As `enable()`, and this device leaves the app's other accounts whatever
	 * `replaceOtherAccounts` says: what the line offers when the device is
	 * notified for another account.
	 */
	switchHere(): Promise<void>;
	/** whether `enable()` makes this device the account's alone (`replaceOtherAccounts`) */
	readonly oneAccountPerDevice: boolean;
	/**
	 * Gets an account, the way a send does (connect's `ensureConnected`): what
	 * the line offers at `no-account`. Never rejects: a cancel is no error, and
	 * the connection flow shows its own failures.
	 */
	signIn(): Promise<void>;
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
	serviceWorker: Readable<PushServiceWorker>;
	/** connect's `ensureConnected()`, to the app's target step: see `signIn` */
	signIn?: () => Promise<unknown>;
	/**
	 * The wallet's signature over the publication message, when the account
	 * carries none: `@etherplay/connect`'s `getSignatureForPublicKeyPublication`,
	 * which asks a wallet at most once per account and key set and keeps the
	 * answer on the account.
	 */
	signOwnership: (address: string, message: string) => Promise<`0x${string}`>;
	/**
	 * One account per device: enabling removes this device's registrations for
	 * the app's other accounts (push-notification-server's option, since 0.2). Default
	 * false, several accounts per device; this app's composition sets it.
	 */
	replaceOtherAccounts?: boolean;
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
			switchHere: async () => {},
			oneAccountPerDevice: !!options.replaceOtherAccounts,
			signIn: async () => {},
			disable: async () => {},
			acknowledgeError() {},
		};
	}

	// narrowed, for the closures below
	const services: NotificationsConfig = config;
	const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
	const appOrigin = fromDomainToOrigin(config.domain);

	function publicationOf(of: NonNullable<NotifiedAccount>) {
		return originPublicKeyPublicationMessage(appOrigin, of.keySet);
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
		// the client knows a registration or none: an absence is none to it
		serviceWorker: derived(options.serviceWorker, ($worker) =>
			typeof $worker === 'string' ? undefined : $worker,
		),
		signOwnership: options.signOwnership,
		fetch: doFetch,
		permission: options.permission,
		supported: options.supported,
		replaceOtherAccounts: options.replaceOtherAccounts,
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
			keySet: {
				signing: {publicKey: of.keySet.signing.publicKey},
				encryption: {publicKey: of.keySet.encryption.publicKey},
			},
			ownershipSignature,
			kind: options.kind,
		});
		const signature = await signRequest(
			{serverOrigin: url.origin, method: 'POST', path: url.pathname, body},
			of.keySet.signing.privateKey,
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
		[options.account, push, trigger, options.serviceWorker] as const,
		([$account, $push, $trigger, $worker], set) => {
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
			if (!$account && $push.status === 'loading') {
				// the client checks only once its account or worker CHANGES, so with
				// neither from the start (dev, no wallet) it would load forever
				set({status: 'no-account', trigger: 'unknown', busy: false});
				return;
			}
			if ($account && $push.status === 'no-account') {
				// the client's `no-account` with an account: no registration (yet)
				set(
					typeof $worker === 'string'
						? {
								status: 'no-worker',
								worker: $worker,
								trigger: 'unknown',
								busy: false,
							}
						: {status: 'loading', trigger: 'unknown', busy: false},
				);
				return;
			}
			set({
				status: $push.status,
				trigger: mine.trigger,
				busy: $push.busy || mine.busy,
				error: mine.error ?? $push.error,
				otherAccounts: $push.otherAccounts,
			});
		},
		{status: 'loading', trigger: 'unknown', busy: false} as NotificationsState,
	);

	async function enable(replaceOtherAccounts?: boolean) {
		const of = account;
		if (!of) return;
		acting = true;
		renewedFor = of;
		try {
			await push.enable(
				replaceOtherAccounts === undefined ? undefined : {replaceOtherAccounts},
			);
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
	}

	return {
		subscribe: store.subscribe,
		oneAccountPerDevice: !!options.replaceOtherAccounts,

		enable: () => enable(),
		switchHere: () => enable(true),

		async signIn() {
			try {
				await options.signIn?.();
			} catch {
				// a cancel is not an error, and the connection flow shows a failure
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
