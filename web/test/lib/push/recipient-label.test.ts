// QA F22: a push for an account other than the signed-in one is shown, in the
// app's own notifications, as being for that account.
import {describe, expect, it} from 'vitest';
import {get, writable} from 'svelte/store';
import {createNotificationsService} from '$lib/core/notifications';
import {
	createRecipientLabels,
	labelled,
	recipientOfPosted,
} from '$lib/push/recipient-label';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';

function fakeContainer() {
	const listeners: ((event: MessageEvent) => void)[] = [];
	return {
		addEventListener(_: 'message', listener: (event: MessageEvent) => void) {
			listeners.push(listener);
		},
		post(data: unknown) {
			for (const listener of listeners) listener({data} as MessageEvent);
		},
	};
}
const posted = (account: string | undefined, body = 'gm') => ({
	type: 'notification',
	notification: {
		title: 'New greeting',
		options: {body, data: account ? {account, navigate: 'demo'} : undefined},
	},
});

describe('a posted push names its recipient', () => {
	it('reads it from the push data, lowercased', () => {
		expect(
			recipientOfPosted(posted(ALICE.toUpperCase().replace('0X', '0x'))),
		).toEqual({
			title: 'New greeting',
			body: 'gm',
			account: ALICE,
		});
		expect(recipientOfPosted(posted(undefined))).toBeUndefined();
		expect(recipientOfPosted({type: 'notification-click'})).toBeUndefined();
	});

	it('labels it for another account, for nobody signed in, and not for the signed-in one', () => {
		const n = {title: 'New greeting', body: 'gm'};
		expect(labelled(n, ALICE, ALICE)).toEqual(n);
		expect(labelled(n, ALICE, BOB).body).toBe(
			'For another account (0x1111...1111): gm',
		);
		expect(labelled(n, ALICE, undefined).body).toBe('For 0x1111...1111: gm');
	});
});

describe('the notifications the worker feeds', () => {
	it('say so when the push is for another account than the signed-in one', () => {
		const container = fakeContainer();
		const service = createNotificationsService();
		const labels = createRecipientLabels(service, container);
		const signedIn = writable<string | undefined>(BOB);
		labels.follow(signedIn);

		// the root's listener comes after this one, and adds what was posted
		container.post(posted(ALICE));
		labels.notifications.add({title: 'New greeting', body: 'gm'});
		container.post(posted(BOB, 'hello'));
		labels.notifications.add({title: 'New greeting', body: 'hello'});
		container.post(posted(undefined, 'a DM'));
		labels.notifications.add({title: 'New greeting', body: 'a DM'});
		// a notification no push was posted for
		labels.notifications.add({title: 'Update', body: 'ready'});

		expect(get(service).map((n) => n.body)).toEqual([
			'For another account (0x1111...1111): gm',
			'hello',
			'a DM',
			'ready',
		]);
	});
});

// QA F23: a node whose pushes name their recipient elsewhere adds a reader
describe('a recipient read where a node names it', () => {
	it('labels a push whose data names its recipient through an added reader', () => {
		const container = fakeContainer();
		const service = createNotificationsService();
		const labels = createRecipientLabels(service, container);
		labels.follow(writable<string | undefined>(BOB));
		const dm = {
			type: 'notification',
			notification: {
				title: 'New message',
				options: {body: 'From 0xaaaa', data: {missiv: {recipient: ALICE}}},
			},
		};

		container.post(dm);
		labels.notifications.add({title: 'New message', body: 'From 0xaaaa'});
		labels.readRecipientWith(
			(data) => (data as {missiv?: {recipient?: unknown}})?.missiv?.recipient,
		);
		container.post(dm);
		labels.notifications.add({title: 'New message', body: 'From 0xaaaa'});

		expect(get(service).map((n) => n.body)).toEqual([
			'From 0xaaaa',
			'For another account (0x1111...1111): From 0xaaaa',
		]);
	});
});
