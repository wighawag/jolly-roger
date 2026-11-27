// QA F23: a clicked direct message for another account than the one connected
// says so, with F22's words, and offers to switch to it.
import {describe, expect, it, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	createOtherAccountNotices,
	otherAccountNotice,
} from '$lib/messaging/other-account';
import {createNotificationsService} from '$lib/core/notifications';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CAROL = '0x3333333333333333333333333333333333333333';

describe('otherAccountNotice', () => {
	it('says whom it is for, as F22 does for a greeting', () => {
		const dm = {recipient: ALICE, with: BOB, connected: CAROL} as const;
		expect(otherAccountNotice(dm, () => {})).toMatchObject({
			title: 'New message',
			body: 'For another account (0x1111...1111): from 0x2222...2222',
			action: {label: 'Switch account'},
		});
		expect(
			otherAccountNotice({...dm, connected: undefined}, () => {}).body,
		).toBe('For 0x1111...1111: from 0x2222...2222');
	});
});

describe('createOtherAccountNotices', () => {
	it('switches to the recipient on the action, and opens the conversation once it is connected', () => {
		const service = createNotificationsService();
		const account = writable<{address: string} | undefined>({address: CAROL});
		const connectTo = vi.fn();
		const open = vi.fn();
		const notice = createOtherAccountNotices({
			notify: service.add,
			connectTo,
			account,
			open,
		});

		notice({recipient: ALICE, with: BOB, connected: CAROL});
		const [shown] = get(service);
		expect(shown.body).toBe(
			'For another account (0x1111...1111): from 0x2222...2222',
		);
		service.onAction(shown.id);
		expect(connectTo).toHaveBeenCalledWith(ALICE);
		expect(open).not.toHaveBeenCalled();

		account.set({address: ALICE.toUpperCase().replace('0X', '0x')});
		expect(open).toHaveBeenCalledWith(BOB);
		// once
		account.set({address: CAROL});
		account.set({address: ALICE});
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('opens at once when the recipient is already connected by the time of the action', () => {
		const service = createNotificationsService();
		const account = writable<{address: string} | undefined>(undefined);
		const connectTo = vi.fn();
		const open = vi.fn();
		const notice = createOtherAccountNotices({
			notify: service.add,
			connectTo,
			account,
			open,
		});
		notice({recipient: ALICE, with: BOB, connected: undefined});
		account.set({address: ALICE});
		service.onAction(get(service)[0].id);
		expect(open).toHaveBeenCalledWith(BOB);
		expect(connectTo).not.toHaveBeenCalled();
	});
});
