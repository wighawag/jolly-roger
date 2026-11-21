import {describe, expect, it, vi} from 'vitest';
import {
	isUpdateAvailable,
	notificationActions,
	UPDATE_NOTICE,
	updateActions,
} from '../../../../src/lib/core/notifications/view';
import type {Notification} from '../../../../src/lib/core/notifications';

// What the notification components show, without the components: which
// actions a card offers and when the update notice appears. The paint
// (`NotificationCard.svelte`) is each kit's; this is the same at every level.

function service() {
	return {onAction: vi.fn(), remove: vi.fn()};
}

describe('notificationActions', () => {
	it('offers the notification its own action first, primary, then dismiss', () => {
		const notifications = service();
		const notification: Notification = {
			id: 7,
			title: 'A new greeting',
			action: {label: 'see it', command: () => {}},
		};
		const actions = notificationActions(notification, notifications);
		expect(actions.map(({label, primary}) => ({label, primary}))).toEqual([
			{label: 'see it', primary: true},
			{label: 'dismiss', primary: undefined},
		]);

		actions[0].onClick();
		expect(notifications.onAction).toHaveBeenCalledWith(7);
		actions[1].onClick();
		expect(notifications.remove).toHaveBeenCalledWith(7);
	});

	it('offers only dismiss, as the primary, when the notification has no action', () => {
		const notifications = service();
		const actions = notificationActions({id: 3, title: 't'}, notifications);
		expect(actions).toHaveLength(1);
		expect(actions[0].label).toBe('dismiss');
		expect(actions[0].primary).toBe(true);
		actions[0].onClick();
		expect(notifications.remove).toHaveBeenCalledWith(3);
		expect(notifications.onAction).not.toHaveBeenCalled();
	});
});

describe('the update notice', () => {
	const registration = {} as ServiceWorkerRegistration;

	it('shows only when a registered worker has an update waiting', () => {
		expect(isUpdateAvailable(undefined)).toBe(false);
		expect(isUpdateAvailable({notSupported: true})).toBe(false);
		expect(isUpdateAvailable({notSupported: false, registering: true})).toBe(
			false,
		);
		expect(
			isUpdateAvailable({
				notSupported: false,
				registering: false,
				updateAvailable: false,
				registration,
			}),
		).toBe(false);
		expect(
			isUpdateAvailable({
				notSupported: false,
				registering: false,
				updateAvailable: true,
				registration: undefined,
			}),
		).toBe(false);
		expect(
			isUpdateAvailable({
				notSupported: false,
				registering: false,
				updateAvailable: true,
				registration,
			}),
		).toBe(true);
	});

	it('says what it is', () => {
		expect(UPDATE_NOTICE.title).toBeTruthy();
		expect(UPDATE_NOTICE.body).toBeTruthy();
	});

	it('reloads into the update as its primary action, or is put off', () => {
		const serviceWorker = {skip: vi.fn(), skipWaiting: vi.fn()};
		const actions = updateActions(serviceWorker);
		expect(actions.map(({label, primary}) => ({label, primary}))).toEqual([
			{label: 'Reload', primary: true},
			{label: 'Dismiss', primary: undefined},
		]);
		actions[0].onClick();
		expect(serviceWorker.skipWaiting).toHaveBeenCalledOnce();
		expect(serviceWorker.skip).not.toHaveBeenCalled();
		actions[1].onClick();
		expect(serviceWorker.skip).toHaveBeenCalledOnce();
	});
});
