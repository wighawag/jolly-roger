/**
 * A PUSH FOR ANOTHER ACCOUNT, SAID SO (QA F22).
 *
 * A device can receive pushes for an account other than the one signed in:
 * with one account per device (F21) until the user switches the device, and
 * always in an app that keeps several accounts per device. A greeting's push
 * names its recipient (`data.account`, `$lib/onchain/notifier/greetings.ts`),
 * so when the page is focused (the worker posts the push to it, and it shows
 * in the app's own notifications) this says whom it is for: "For another
 * account (0x1234...abcd): ..." when signed in as someone else, "For
 * 0x1234...abcd: ..." when nobody is signed in, nothing when it is the
 * signed-in account's or names nobody (missiv's direct messages do not, yet).
 *
 * NODE-LOCAL, NOT A ROOT HOOK (the human's choice): the root's service worker
 * module turns a posted push into an in-app notification without its data, so
 * this listens to the same worker messages FIRST (it is installed when
 * `$lib/index.ts` loads, the root's listener on `DOMContentLoaded`), keeps the
 * recipient of the latest posted push, and the notifications service handed to
 * the root's `createServiceWorker` labels the notification that matches it.
 * A notification the OS shows while the app is not focused is not labelled:
 * the worker does not know who is signed in.
 *
 * The signed-in account is the app context's (`follow`, from
 * `$lib/context/app.ts`): process-scoped like the worker registration it
 * listens to, it only holds the address the context gives it.
 */
import type {Readable} from 'svelte/store';
import type {
	NotificationsService,
	NotificationToAdd,
} from '$lib/core/notifications';
import {truncateHex} from '$lib/core/utils/format/hex';

type Posted = {title?: string; body?: string; account: string};

/** The recipient a posted push names, if any: `{type: 'notification', notification: {title, options: {body, data}}}`. */
export function recipientOfPosted(message: unknown): Posted | undefined {
	if (!message || typeof message !== 'object') return undefined;
	const {type, notification} = message as {
		type?: unknown;
		notification?: {
			title?: unknown;
			options?: {body?: unknown; data?: {account?: unknown}};
		};
	};
	if (type !== 'notification' || !notification) return undefined;
	const account = notification.options?.data?.account;
	if (typeof account !== 'string' || !account.startsWith('0x')) {
		return undefined;
	}
	return {
		title:
			typeof notification.title === 'string' ? notification.title : undefined,
		body:
			typeof notification.options?.body === 'string'
				? notification.options.body
				: undefined,
		account: account.toLowerCase(),
	};
}

/** The notification as shown, said for `recipient` when it is not `signedIn`. */
export function labelled(
	notification: NotificationToAdd,
	recipient: string,
	signedIn: string | undefined,
): NotificationToAdd {
	const me = signedIn?.toLowerCase();
	if (me === recipient) return notification;
	const who = truncateHex(recipient);
	const prefix = me ? `For another account (${who})` : `For ${who}`;
	return {
		...notification,
		body: notification.body ? `${prefix}: ${notification.body}` : prefix,
	};
}

export type RecipientLabels = {
	/** the notifications service to hand to `createServiceWorker` */
	notifications: NotificationsService;
	/** follows the signed-in account (its wallet address, or undefined) */
	follow(account: Readable<string | undefined>): () => void;
};

export function createRecipientLabels(
	notifications: NotificationsService,
	container:
		| {
				addEventListener(
					type: 'message',
					listener: (event: MessageEvent) => void,
				): void;
		  }
		| undefined,
): RecipientLabels {
	let signedIn: string | undefined;
	let latest: Posted | undefined;
	container?.addEventListener('message', (event) => {
		latest = recipientOfPosted(event.data);
	});
	return {
		notifications: {
			...notifications,
			add(notification: NotificationToAdd) {
				const posted = latest;
				if (
					posted &&
					posted.title === notification.title &&
					posted.body === notification.body
				) {
					latest = undefined;
					notifications.add(labelled(notification, posted.account, signedIn));
					return;
				}
				notifications.add(notification);
			},
		},
		follow(account) {
			return account.subscribe((address) => {
				signedIn = address?.toLowerCase();
			});
		},
	};
}
