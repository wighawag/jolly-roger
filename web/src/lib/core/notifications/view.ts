/**
 * WHAT A NOTIFICATION CARD SHOWS, WITHOUT THE CARD.
 *
 * The root's two notification components (`./Notifications.svelte` and
 * `../service-worker/VersionAndInstallNotfications.svelte`) are behaviour only:
 * which notifications are up, which actions each offers, when the update notice
 * appears, and the live region they are announced in. Both paint through ONE
 * file, `./NotificationCard.svelte`, which is the only one a kit (Tailwind,
 * shadcn, ...) rewrites. A level that restyles the notifications therefore
 * modifies one file, and a change to the behaviour here reaches every level
 * without a conflict.
 *
 * The functions are here rather than in the components so they are tested in
 * Node (test/lib/core/notifications/view.test.ts) and so the components stay
 * logic-less (AGENTS.md).
 */
import type {Notification, NotificationsService} from '.';
import type {ServiceWorkerState, ServiceWorkerStore} from '../service-worker';

/** What a card shows. The update notice is one too. */
export type NotificationData = {
	title: string;
	body?: string;
	icon?: string;
};

/** One button of a card; the primary one is its main answer. */
export type NotificationAction = {
	label: string;
	onClick: () => void;
	primary?: boolean;
};

/**
 * How a card is laid out: `card`, a panel in a stack (the notifications), or
 * `banner`, one row across the top of the page (the update notice, by
 * default). Each kit's card honours both.
 */
export type NotificationLayout = 'card' | 'banner';

/**
 * Where the update notice shows: `banner`, across the top (the default, so it
 * never shares the corner the notifications stack in), or `corner`, a card
 * stacked where the notifications are.
 */
export type NoticePlacement = 'banner' | 'corner';

/**
 * The parts of a card a caller may add classes to, through a component's
 * `classes` prop. Every card honours `root`; the others are the kit's to
 * honour where it has that part.
 */
export type NotificationClasses = {
	/**
	 * The region the update notice is placed in (its full-width strip as a
	 * banner), honoured by the component rather than the card
	 */
	region?: string;
	/** Root container of the notification */
	root?: string;
	/** Icon wrapper */
	icon?: string;
	/** Title text */
	title?: string;
	/** Body/description text */
	body?: string;
	/** Actions container */
	actions?: string;
	/** Default buttons (ok/dismiss) */
	button?: string;
	/** Primary action button (e.g., "Reload") */
	primaryButton?: string;
};

/**
 * A notification's buttons: its own action first, as the primary, then
 * dismiss; dismiss alone, as the primary, when it has no action.
 */
export function notificationActions(
	notification: Notification,
	notifications: Pick<NotificationsService, 'onAction' | 'remove'>,
): NotificationAction[] {
	const dismiss = () => notifications.remove(notification.id);
	if (notification.action) {
		return [
			{
				label: notification.action.label,
				onClick: () => notifications.onAction(notification.id),
				primary: true,
			},
			{label: 'dismiss', onClick: dismiss},
		];
	}
	return [{label: 'dismiss', onClick: dismiss, primary: true}];
}

/** Whether a registered worker has an update waiting to be reloaded into. */
export function isUpdateAvailable(state: ServiceWorkerState): boolean {
	return !!(
		state &&
		!state.notSupported &&
		!state.registering &&
		'updateAvailable' in state &&
		state.updateAvailable &&
		state.registration
	);
}

/** The update notice's wording. */
export const UPDATE_NOTICE: NotificationData = {
	title: 'A new version is available.',
	body: 'Reload to get the update.',
};

/** The update notice's buttons: reload into it, or put it off. */
export function updateActions(
	serviceWorker: Pick<ServiceWorkerStore, 'skip' | 'skipWaiting'>,
): NotificationAction[] {
	return [
		{
			label: 'Reload',
			onClick: () => serviceWorker.skipWaiting(),
			primary: true,
		},
		{label: 'Dismiss', onClick: () => serviceWorker.skip()},
	];
}
