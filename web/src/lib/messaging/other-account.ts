/**
 * A CLICKED DIRECT MESSAGE FOR ANOTHER ACCOUNT, SAID SO (QA F23, F22's
 * remainder).
 *
 * A device can receive pushes for an account other than the one connected
 * (one account per device until the user switches it, QA F21; always in an app
 * that keeps several). missiv 0.5 names the push's `recipient`, so a click on
 * one (the worker's, or the hand-off the page read from its URL) does not open
 * a conversation the connected account is not in: the app's own notification
 * says whom it is for, with F22's words ("For another account (0x..)", "For
 * 0x.." when nobody is connected), and offers to switch to that account, then
 * opens the conversation once it is the one connected.
 */
import type {Readable} from 'svelte/store';
import type {NotificationToAdd} from '$lib/core/notifications';
import {truncateHex} from '$lib/core/utils/format/hex';
import type {OtherAccountDM} from './panel';

/** The notification shown for `dm`, its action switching to the recipient. */
export function otherAccountNotice(
	dm: OtherAccountDM,
	switchTo: () => void,
): NotificationToAdd {
	const who = truncateHex(dm.recipient);
	const prefix = dm.connected ? `For another account (${who})` : `For ${who}`;
	return {
		title: 'New message',
		body: `${prefix}: from ${truncateHex(dm.with)}`,
		action: {label: 'Switch account', command: switchTo},
	};
}

/**
 * What `openConversationsFromClicks` calls for a DM for another account: show
 * the notice; its action asks the connection for the recipient
 * (`connectToAddress`, which asks the wallet to switch when it must) and opens
 * the conversation once `account` is the recipient. A later notice replaces
 * the wait of an earlier one.
 */
export function createOtherAccountNotices(options: {
	notify: (notification: NotificationToAdd) => void;
	connectTo: (address: `0x${string}`) => void;
	account: Readable<{address: string} | undefined>;
	open: (address: `0x${string}`) => void;
}): (dm: OtherAccountDM) => void {
	let waiting: (() => void) | undefined;
	return (dm) => {
		options.notify(
			otherAccountNotice(dm, () => {
				waiting?.();
				let done = false;
				let stop: (() => void) | undefined;
				const finish = () => {
					done = true;
					stop?.();
					if (waiting === finish) waiting = undefined;
				};
				stop = options.account.subscribe((account) => {
					if (done || account?.address.toLowerCase() !== dm.recipient) return;
					finish();
					options.open(dm.with);
				});
				if (done) {
					stop();
					return;
				}
				waiting = finish;
				options.connectTo(dm.recipient);
			}),
		);
	};
}
