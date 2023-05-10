import {get, writable} from 'svelte/store';

export type ServiceWorkerState = {
	registration?: ServiceWorkerRegistration;
	updateAvailable: boolean;
};

const store = writable<ServiceWorkerState>({
	registration: undefined,
	updateAvailable: false,
});
export const serviceWorker = {
	...store,
	get registration(): ServiceWorkerRegistration | undefined {
		return get(store).registration;
	},
	get updateAvailable(): boolean {
		return get(store).updateAvailable;
	},
};

// allow to test service worker notifcation by executing the following in the console:
// serviceWorker.update(v => {v.updateAvailable = true; v.registration = "anything"; return v});
(globalThis as any).serviceWorker = store;
