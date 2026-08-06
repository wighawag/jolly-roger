import {get, writable} from 'svelte/store';

export type NotificationToAdd = {
	title: string;
	body?: string;
	icon?: string;
	action?: {label: string; command: () => unknown};
};
export type Notification = NotificationToAdd & {id: number};

export function createNotificationsService() {
	let lastId = 1;
	const store = writable<Notification[]>([]);

	function add(notification: NotificationToAdd) {
		store.update((notifications) => [
			...notifications,
			{...notification, id: ++lastId},
		]);
	}

	function remove(id: number) {
		store.update((notifications) =>
			notifications.filter((notification) => notification.id !== id),
		);
	}

	function onAction(id: number) {
		const notification = get(store).find((v) => v.id == id);

		if (notification) {
			remove(id);
			notification.action?.command();
		}
	}
	return {subscribe: store.subscribe, add, remove, onAction};
}

export type NotificationsService = ReturnType<
	typeof createNotificationsService
>;
