import {dev} from '$app/environment';
import {get, writable} from 'svelte/store';
import type {Logger} from 'named-logs';
import {logs} from 'named-logs';
import {handleAutomaticUpdate, listenForWaitingServiceWorker} from './utils';

import {resolve} from '$app/paths';
import type {NotificationsService, NotificationToAdd} from '../notifications';
import {pushState} from '$app/navigation';
import {page} from '$app/state';

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

type JSONNotification = {
	title: string;
	options?: NotificationOptions;
};

function fromPushNotification(
	pushNotification: JSONNotification,
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
						pushState(navigate, page.state);
					},
				}
			: undefined,
	};
}

export function createServiceWorker(notifications?: NotificationsService) {
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

	function register() {
		if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
			// Clean up any existing listeners before registering new ones
			cleanup();

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
						notifications.add(fromPushNotification(event.data));
					}
				};
				navigator.serviceWorker.addEventListener('message', messageHandler);
			}

			const swLocation = resolve<any>(`/service-worker.js`);
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
					console.error(e);
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
					logger.error('Failed to register service worker', e);
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
