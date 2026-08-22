import {get, writable} from 'svelte/store';
import type {Logger} from 'named-logs';
import {logs} from 'named-logs';
import {handleAutomaticUpdate, listenForWaitingServiceWorker} from './utils';
import {wouldDisturbForeignWorker} from './scope';

import type {NotificationsService, NotificationToAdd} from '../notifications';
import type {PathResolver} from '../utils/web/path';

/**
 * The two things registration needs from whoever is hosting it.
 *
 * Both are framework answers (where a build is deployed, and how to follow a
 * URL), so they arrive as functions instead of imports and this module stays
 * free of `$app/*`. `$lib/kit` supplies them; see src/lib/kit/README.md.
 */
export type ServiceWorkerEnvironment = {
	/** Rewrites `/service-worker.js` for this deployment (base path, IPFS). */
	resolvePath: PathResolver;
	/**
	 * Follow the URL a push notification carried, without a full page load.
	 *
	 * Only ever called from a notification the user acted on, which is why it is
	 * allowed to move the page at all.
	 */
	navigateTo: (url: string) => void;
};

/**
 * Dev mode, from the BUNDLER rather than the framework.
 *
 * Same answer as SvelteKit's `dev`, one less import that names it. It decides
 * whether the worker is registered as a module and how stale registrations are
 * treated, neither of which is worth an injection point.
 */
const dev = import.meta.env.DEV;

const logger = logs('service-worker') as Logger & {
	level: number;
	enabled: boolean;
};

function updateLoggingForWorker(worker: ServiceWorker | null) {
	if (worker) {
		if (logger.enabled) {
			logger.debug(
				`enabling logging for service worker, level: ${logger.level}`,
			);
		} else {
			logger.debug(
				`disabling logging for service worker, level: ${logger.level}`,
			);
		}
		worker.postMessage({
			type: 'debug',
			level: logger.level,
			enabled: logger.enabled,
		});
	}
}

const IDLE_DELAY_MS = 3 * 60 * 1000;
const CHECK_DELAY_MS = 30 * 60 * 1000;

/**
 * Why `register()` deliberately did not register our service worker.
 *
 * Modelled as a frozen object + union type rather than a TS `enum`: the project
 * runs with `verbatimModuleSyntax`/`isolatedModules`, where a `const enum` is
 * illegal and a plain `enum` emits runtime code that does not tree-shake. This
 * shape erases to a plain string, so it survives structured-clone/JSON and can
 * be compared across the worker boundary.
 */
export const SkipReason = {
	/**
	 * A service worker that is not ours already covers the scope our registration
	 * would claim, so registering would either replace it or take control of the
	 * page away from it. The IPFS service-worker-gateway case (inbrowser.link,
	 * helia based gateways, ...), where the host page is served by the gateway's
	 * own worker at scope `/`.
	 */
	ForeignScopeOwner: 'foreign-scope-owner',
} as const;
export type SkipReason = (typeof SkipReason)[keyof typeof SkipReason];

export type ServiceWorkerState =
	| undefined
	| {
			notSupported: true;
	  }
	| {
			notSupported: false;
			registering: true;
	  }
	| {
			// Service workers are supported, but we deliberately did NOT register
			// ours. `skipped` is the discriminant AND the reason; see `register()`
			// for the full rationale. `controllerScriptURL` is kept so the reason
			// outlives the log line and can be surfaced in a debug/status UI.
			notSupported: false;
			registering: false;
			skipped: SkipReason;
			controllerScriptURL: string;
			registration: undefined;
			updateAvailable: false;
	  }
	| {
			notSupported: false;
			registering: false;
			error: {message: string; cause: any};
			registration: undefined;
			updateAvailable: false;
	  }
	| {
			registration?: ServiceWorkerRegistration;
			updateAvailable: boolean;
			notSupported: false;
			registering: false;
	  };

/**
 * What `unregisterStale()` found on this origin: the registrations of OUR OWN
 * worker it removed, and the ones belonging to someone else that it left
 * strictly alone. Each entry is a human-readable `scriptURL (scope ...)`.
 */
export type StaleWorkerReport = {
	removed: string[];
	foreign: string[];
	/**
	 * Registrations whose script URL could not be read, because `installing`,
	 * `waiting` and `active` were all still null. Transient, but real: a
	 * registration exists before its worker object is attached. They are left
	 * alone rather than guessed at, since guessing either way is harmful: called
	 * ours, we would unregister a worker that might not be ours; called foreign,
	 * we would skip a genuinely stale one AND cry wolf about it.
	 */
	unresolved: string[];
};

type JSONNotification = {
	title: string;
	options?: NotificationOptions;
};

const NOT_REGISTERED_MESSAGE = `service worker was not registered: another worker covers our scope`;

type SkippedState = Extract<ServiceWorkerState, {skipped: SkipReason}>;

function isSkipped(state: ServiceWorkerState): state is SkippedState {
	return !!state && 'skipped' in state;
}

function fromPushNotification(
	pushNotification: JSONNotification,
	navigateTo: (url: string) => void,
): NotificationToAdd {
	const navigate = pushNotification.options?.data?.navigate;
	return {
		title: pushNotification.title,
		body: pushNotification.options?.body,
		icon: pushNotification.options?.icon,
		action: navigate
			? {
					label: 'ok',
					command: () => {
						navigateTo(navigate);
					},
				}
			: undefined,
	};
}

export function createServiceWorker(
	environment: ServiceWorkerEnvironment,
	notifications?: NotificationsService,
) {
	const {resolvePath, navigateTo} = environment;
	const store = writable<ServiceWorkerState>(undefined);

	// Track registered listeners for cleanup
	let controllerChangeHandler: (() => void) | null = null;
	let messageHandler: ((event: MessageEvent) => void) | null = null;

	function pingServideWorker(
		state: 'installing' | 'waiting' | 'active' = 'active',
	) {
		sendMessage(
			{
				type: 'ping',
			},
			state,
		);
	}

	function sendMessage(
		message: string | object,
		state: 'installing' | 'waiting' | 'active' = 'active',
	) {
		const $serviceWorker = get(store);
		if (!$serviceWorker) {
			throw new Error(`not loaded`);
		}
		if ($serviceWorker.notSupported) {
			throw new Error(`not supported`);
		}
		if ($serviceWorker.registering) {
			throw new Error(`is registering...`);
		}
		if (isSkipped($serviceWorker)) {
			throw new Error(
				`${NOT_REGISTERED_MESSAGE} (${$serviceWorker.controllerScriptURL})`,
			);
		}
		const registration = $serviceWorker.registration;
		if (!registration) {
			throw new Error(`no registration`);
		}
		if (!registration[state]) {
			throw new Error(`no registration in state: ${state}`);
		}
		registration[state].postMessage(message);
	}

	function skipWaiting() {
		logger.log(`accepting update...`);
		const $serviceWorker = get(store);
		if (!$serviceWorker) {
			throw new Error(`not loaded`);
		}
		if ($serviceWorker.notSupported) {
			throw new Error(`not supported`);
		}
		if ($serviceWorker.registering) {
			throw new Error(`is registering...`);
		}
		if (isSkipped($serviceWorker)) {
			// nothing to update, we never registered. Not thrown: this is reachable
			// from a UI button and must not blow up an onclick handler.
			logger.log(NOT_REGISTERED_MESSAGE);
			return;
		}
		if ($serviceWorker.updateAvailable && $serviceWorker.registration) {
			const registration = $serviceWorker.registration;
			if (!registration) {
				throw new Error(`no registration`);
			}

			if (registration.waiting) {
				logger.log(`was waiting, skipping...`);
				registration.waiting.postMessage('skipWaiting');
			} else {
				logger.log(`was not waiting, should we reload?`);
				logger.error(`not waiting..., todo reload?`);
				// window.location.reload();
			}

			if (!dev) {
				logger.log(`update store`);
				store.set({
					notSupported: false,
					updateAvailable: false,
					registration: $serviceWorker.registration,
					registering: $serviceWorker.registering,
				});
			}
		}
	}

	function skip() {
		const $serviceWorker = get(store);
		if (!$serviceWorker) {
			throw new Error(`not loaded`);
		}
		if ($serviceWorker.notSupported) {
			throw new Error(`not supported`);
		}
		if ($serviceWorker.registering) {
			throw new Error(`is registering...`);
		}
		if (isSkipped($serviceWorker)) {
			// nothing to dismiss, we never registered
			return;
		}
		store.set({
			notSupported: false,
			updateAvailable: false,
			registration: $serviceWorker.registration,
			registering: $serviceWorker.registering,
		});
	}

	/**
	 * Remove all registered event listeners.
	 * Call this when unmounting to prevent listener accumulation.
	 */
	function cleanup() {
		if (
			controllerChangeHandler &&
			typeof navigator !== 'undefined' &&
			'serviceWorker' in navigator
		) {
			navigator.serviceWorker.removeEventListener(
				'controllerchange',
				controllerChangeHandler,
			);
			controllerChangeHandler = null;
		}

		if (
			messageHandler &&
			typeof navigator !== 'undefined' &&
			'serviceWorker' in navigator
		) {
			navigator.serviceWorker.removeEventListener('message', messageHandler);
			messageHandler = null;
		}
	}

	/**
	 * Remove a leftover registration of OUR OWN worker, and report it.
	 *
	 * For dev, where we deliberately do not register (see `+layout.ts`). Not
	 * registering does not UNregister: a worker installed by a production build
	 * previously served on this origin (a `pnpm preview`, an E2E run, a
	 * `build` served locally, all of which typically reuse the dev port) stays
	 * installed and keeps serving the page from its cache. The symptom is
	 * assets that will not update no matter what you edit, which reads as a
	 * build or HMR problem rather than a service worker one.
	 *
	 * ONLY ever unregisters a worker whose script URL is exactly ours. A foreign
	 * worker is left strictly alone: on an IPFS service worker gateway the
	 * foreign worker IS the thing serving the site, and unregistering it would
	 * break the page. Same reasoning as the guard in `register()`, applied to
	 * the opposite operation.
	 */
	async function unregisterStale(): Promise<StaleWorkerReport> {
		const report: StaleWorkerReport = {
			removed: [],
			foreign: [],
			unresolved: [],
		};
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
			return report;
		}
		const swURL = new URL(resolvePath(`/service-worker.js`), location.href)
			.href;
		try {
			const registrations = await navigator.serviceWorker.getRegistrations();
			for (const registration of registrations) {
				const scriptURL = (
					registration.active ??
					registration.waiting ??
					registration.installing
				)?.scriptURL;
				// Unlike a `ServiceWorker`, a REGISTRATION does expose its scope, so
				// the report can be precise where the registration-time guard cannot.
				const describe = `${scriptURL ?? '(script not readable yet)'} (scope ${registration.scope})`;
				if (!scriptURL) {
					// cannot tell whose it is: say so, touch nothing
					report.unresolved.push(describe);
					continue;
				}
				if (scriptURL !== swURL) {
					// not ours: never touch it
					report.foreign.push(describe);
					continue;
				}
				await registration.unregister();
				report.removed.push(describe);
			}

			// console, not the logger: these change (or explain) what the page is
			// actually served from, so they have to show regardless of log level.
			if (report.removed.length > 0) {
				console.warn(
					`unregistered a stale service worker left over on this origin by a production build: ${report.removed.join(', ')}. Reload to be sure nothing is still served from its cache.`,
				);
			}
			if (report.foreign.length > 0) {
				// Deliberately NOT removed: it is not ours to remove. Most likely
				// another project that used this same port (an origin is scheme +
				// host + PORT, so dev servers sharing a port share a worker), and it
				// may well be serving this page from its cache.
				console.warn(
					`a service worker that is not ours is registered on this origin and was left alone: ${report.foreign.join(', ')}. If this origin was previously used by another project, that worker may be serving stale content here. Remove it yourself with: navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))`,
				);
			}
			if (report.unresolved.length > 0) {
				console.warn(
					`a service worker registration is present but its script cannot be read yet, so it was left alone: ${report.unresolved.join(', ')}. Reload to classify it.`,
				);
			}
			if (
				report.removed.length === 0 &&
				report.foreign.length === 0 &&
				report.unresolved.length === 0
			) {
				logger.debug(`no service worker registered on this origin`);
			}
		} catch (e) {
			console.warn(`could not check for a stale service worker`, e);
		}
		return report;
	}

	function register() {
		if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
			// Clean up any existing listeners before registering new ones
			cleanup();

			const swLocation = resolvePath(`/service-worker.js`);
			const swURL = new URL(swLocation, location.href).href;

			// ------------------------------------------------------------------------------------------------
			// DO NOT REGISTER WHEN A FOREIGN WORKER ALREADY COVERS OUR SCOPE
			// ------------------------------------------------------------------------------------------------
			// On an IPFS service-worker gateway (inbrowser.link and friends) the page
			// itself is served by the gateway's own service worker registered at scope
			// `/`, which is what performs the trustless, verified fetching of the site.
			//
			// Registering our worker underneath that is destructive in one of two ways,
			// depending on how the scopes line up:
			//   - SAME scope: registrations are keyed by scope, so ours REPLACES the
			//     gateway's registration outright.
			//   - WIDER foreign scope (gateway at `/`, us at `/ipfs/<cid>/` on a path
			//     gateway): nothing is replaced, but a client is controlled by the
			//     LONGEST matching scope, so our narrower registration silently TAKES
			//     CONTROL of the page away from the verifying worker.
			// Either way verified fetching stops, and our worker cannot stand in for it:
			// a `fetch()` issued from inside a service worker is not intercepted by
			// another service worker, so our passthrough requests reach the gateway's
			// origin server, which answers with its bootstrap HTML instead of content.
			//
			// In practice registration usually fails before it can do any of that: by
			// spec the fetch of a service worker script bypasses any active service
			// worker, so the request for our script never reaches the gateway worker.
			// It hits the origin server, which answers with that same bootstrap HTML
			// (`content-type: text/html`), and browsers reject a service worker script
			// served with a non-JS MIME type with a `SecurityError` ("The operation is
			// insecure." in Firefox). We do not want to rely on a MIME mismatch to
			// protect the gateway: do NOT "fix" this by making registration succeed.
			//
			// WHAT IS TESTED lives in `./scope.ts` (unit tests in
			// `test/lib/core/service-worker/scope.test.ts`, end to end against a
			// real emulated gateway in `e2e/tests/service-worker-gateway.e2e.ts`):
			// simply whether a worker that is not ours controls this page. It
			// deliberately does NOT compare scopes, because a controlling worker's
			// scope cannot be read synchronously and guessing it from the script's
			// directory is demonstrably wrong against a real gateway; `./scope.ts`
			// documents that in full. The comparison is on absolute URLs, so
			// base-path and path-gateway deployments still recognise OUR OWN worker
			// on repeat visits (in which case we do register, to keep the update
			// flow working).
			//
			// KNOWN GAP: this only sees a worker that CONTROLS the page, so after a
			// hard reload (ctrl+shift+r) the page is uncontrolled and we try to
			// register anyway. On a gateway that attempt fails on MIME as described
			// above and lands in `error` rather than `skipped`. Closing it needs the
			// async `navigator.serviceWorker.getRegistrations()`, whose await would
			// fall on every first visit (an uncontrolled page is exactly the
			// first-visit signature) to defend a rare case, so it is left open.
			const controller = navigator.serviceWorker.controller;
			if (
				controller &&
				wouldDisturbForeignWorker(swURL, controller.scriptURL)
			) {
				logger.log(
					`page is controlled by a foreign service worker (${controller.scriptURL}), skipping registration of ${swURL}`,
				);
				store.set({
					notSupported: false,
					registering: false,
					skipped: SkipReason.ForeignScopeOwner,
					controllerScriptURL: controller.scriptURL,
					registration: undefined,
					updateAvailable: false,
				});
				return;
			}
			// ------------------------------------------------------------------------------------------------

			store.set({notSupported: false, registering: true});

			// ------------------------------------------------------------------------------------------------
			// FORCE RELOAD ON CONTROLLER CHANGE (update flow only)
			// ------------------------------------------------------------------------------------------------
			// `controllerchange` fires in two situations:
			// 1. FIRST INSTALL: the SW's activate handler calls clients.claim(), taking
			//    control of the already-open page. Reloading here would make every
			//    first visit spontaneously reload seconds after load (whenever the
			//    SW finishes installing), wiping in-flight UI state.
			// 2. UPDATE: a new SW replaces the old one (after skipWaiting). Here a
			//    reload is wanted so the page runs the new version's assets.
			// Distinguish them by whether the page was already controlled: only an
			// already-controlled page can be taken over by an UPDATED worker.
			let wasControlled = !!navigator.serviceWorker.controller;
			let refreshing = false;
			controllerChangeHandler = () => {
				if (!wasControlled) {
					// Initial claim on first install: do not reload.
					wasControlled = true;
					return;
				}
				if (refreshing) {
					return;
				}
				refreshing = true;
				window.location.reload();
			};
			navigator.serviceWorker.addEventListener(
				'controllerchange',
				controllerChangeHandler,
			);
			// ------------------------------------------------------------------------------------------------

			if (notifications) {
				// Listen to messages
				messageHandler = (event: MessageEvent) => {
					if (event.data && event.data.type === 'notification') {
						notifications.add(fromPushNotification(event.data, navigateTo));
					}
				};
				navigator.serviceWorker.addEventListener('message', messageHandler);
			}

			//{scope: `${base}/`}
			navigator.serviceWorker
				.register(swLocation, {
					type: dev ? 'module' : 'classic',
				})
				.then((registration) => {
					try {
						handleAutomaticUpdate(registration, {
							idle: IDLE_DELAY_MS,
							checks: CHECK_DELAY_MS,
						});
					} catch (e) {}

					store.set({
						notSupported: false,
						updateAvailable: false,
						registration: registration,
						registering: false,
					});
					updateLoggingForWorker(registration.installing);
					updateLoggingForWorker(registration.waiting);
					updateLoggingForWorker(registration.active);
					listenForWaitingServiceWorker(registration, () => {
						store.set({
							notSupported: false,
							updateAvailable: true,
							registration: registration,
							registering: false,
						});
					});
				})
				.catch((e) => {
					// deliberately `console.warn` and not the named-logs logger: a failed
					// registration silently disables offline support and push, so it has to
					// show even when the app's log level is off. It stays a WARNING and not
					// a red error because it is an environment condition (restricted
					// context, unusual hosting, ...), not a bug.
					console.warn(`failed to register service worker`, e);
					store.set({
						registering: false,
						notSupported: false,
						updateAvailable: false,
						registration: undefined,
						error: {
							message: `failed to register service-worker`,
							cause: e.message || e,
						},
					});
				});
		} else {
			if (typeof window !== 'undefined') {
				store.set({notSupported: true});
			}
		}
	}

	return {
		subscribe: store.subscribe,
		get registration(): ServiceWorkerRegistration | undefined {
			const $serviceWorker = get(store);
			if ($serviceWorker && 'registration' in $serviceWorker) {
				return $serviceWorker.registration;
			} else {
				return undefined;
			}
		},
		get updateAvailable(): boolean {
			const $serviceWorker = get(store);
			if ($serviceWorker && 'updateAvailable' in $serviceWorker) {
				return $serviceWorker.updateAvailable;
			} else {
				return false;
			}
		},
		register,
		unregisterStale,
		pingServideWorker,
		sendMessage,
		skipWaiting,
		skip,
		/**
		 * Clean up registered event listeners.
		 * Call this when unmounting to prevent listener accumulation.
		 */
		cleanup,
	};
}

export type ServiceWorkerStore = ReturnType<typeof createServiceWorker>;
