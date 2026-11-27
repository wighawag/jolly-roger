import {describe, expect, it, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import type {ConversationList, CurrentConversation} from '@missiv/client';
import type {Conversation, ConversationStatus} from '@missiv/common';
import {
	conversationFromNotification,
	createComposer,
	openConversationsFromClicks,
	roomAuthorToMessage,
	createMessagingPanel,
	inboxOf,
} from '$lib/messaging/panel.js';
import type {MessagingServices} from '$lib/messaging/messaging.js';
import {getConversationID} from '@missiv/common';

const ME = '0x00000000000000000000000000000000000000aa';
const BOB = '0x00000000000000000000000000000000000000bb';
const CAROL = '0x00000000000000000000000000000000000000cc';

/** A row of ME's inbox: its status, the last seq read and the last seq, the newest message's time. */
function conversationWith(
	other: string,
	fields: {
		status: ConversationStatus;
		lastReadSeq: number;
		lastSeq: number;
		lastMessageAt: number;
	},
): Conversation {
	return {
		domain: 'app.example',
		namespace: 'demo',
		conversationID: `${other}${ME}`,
		members: [ME, other] as `0x${string}`[],
		version: 1,
		...fields,
	};
}

describe('inboxOf', () => {
	it('names the other member of each conversation, newest first, and counts unread and requests', () => {
		const list: ConversationList = {
			step: 'Fetched',
			address: ME,
			conversations: [
				conversationWith(BOB, {
					status: 'accepted',
					lastReadSeq: 5,
					lastSeq: 9,
					lastMessageAt: 9,
				}),
				conversationWith(CAROL, {
					status: 'unaccepted',
					lastReadSeq: 0,
					lastSeq: 1,
					lastMessageAt: 12,
				}),
			],
			numUnread: 1,
			numUnaccepted: 1,
		};
		expect(inboxOf(list)).toEqual({
			step: 'Fetched',
			count: 2,
			items: [
				{address: CAROL, accepted: false, unread: false, lastMessage: 12},
				{address: BOB, accepted: true, unread: true, lastMessage: 9},
			],
			rejected: [],
		});
	});

	it('lists no rejected conversation, and names its other member apart', () => {
		const list: ConversationList = {
			step: 'Fetched',
			address: ME,
			conversations: [
				conversationWith(BOB, {
					status: 'rejected',
					lastReadSeq: 0,
					lastSeq: 2,
					lastMessageAt: 20,
				}),
			],
			numUnread: 0,
			numUnaccepted: 0,
		};
		expect(inboxOf(list)).toEqual({
			step: 'Fetched',
			count: 0,
			items: [],
			rejected: [BOB],
		});
	});

	it('is the list step before it is fetched', () => {
		expect(inboxOf({step: 'Idle'})).toEqual({step: 'Idle'});
		expect(inboxOf({step: 'Fetching', address: ME})).toEqual({
			step: 'Fetching',
		});
	});
});

function fetched(conversations: string[]): ConversationList {
	return {
		step: 'Fetched',
		address: ME,
		conversations: conversations.map((other) =>
			conversationWith(other, {
				status: 'unaccepted',
				lastReadSeq: 0,
				lastSeq: 1,
				lastMessageAt: 1,
			}),
		),
		numUnread: 0,
		numUnaccepted: conversations.length,
	};
}

function fakeServices(
	conversations: string[] = [],
	initial: ConversationList = fetched(conversations),
) {
	const list = writable<ConversationList>(initial);
	const stores = new Map<string, CurrentConversation>();
	const services = {
		room: {} as MessagingServices['room'],
		conversations: {subscribe: list.subscribe},
		conversation: vi.fn((address: string, options?: {read?: boolean}) => {
			const key = `${address}:${options?.read ?? true}`;
			if (!stores.has(key)) {
				stores.set(key, {
					subscribe: writable({}).subscribe,
				} as unknown as CurrentConversation);
			}
			return stores.get(key)!;
		}),
		accept: vi.fn(async () => {}),
		reject: vi.fn(async () => {}),
	} satisfies MessagingServices;
	return {services, list};
}

describe('createMessagingPanel', () => {
	it('opens on a conversation, which a page asks for by address', () => {
		const {services} = fakeServices();
		const panel = createMessagingPanel(services);
		expect(get(panel)).toMatchObject({open: false, view: {kind: 'room'}});
		panel.openConversation('0x00000000000000000000000000000000000000BB');
		expect(get(panel)).toMatchObject({
			open: true,
			view: {kind: 'conversation', address: BOB},
		});
		panel.toggle();
		expect(get(panel).open).toBe(false);
	});

	it('shows a conversation this account starts as accepted, read as it is shown', () => {
		const {services} = fakeServices();
		const panel = createMessagingPanel(services);
		panel.openConversation(BOB);
		const view = get(panel.conversationView);
		expect(view).toMatchObject({address: BOB, accepted: true});
		expect(services.conversation).toHaveBeenLastCalledWith(BOB, {read: true});
	});

	it('shows a request without answering it, until accepted', async () => {
		const {services} = fakeServices([BOB]);
		const panel = createMessagingPanel(services);
		const stop = panel.conversationView.subscribe(() => {});
		panel.openConversation(BOB);
		expect(get(panel.conversationView)?.accepted).toBe(false);
		expect(services.conversation).toHaveBeenLastCalledWith(BOB, {read: false});

		await panel.accept(BOB);
		expect(services.accept).toHaveBeenCalledWith(BOB);
		expect(get(panel.conversationView)?.accepted).toBe(true);
		expect(services.conversation).toHaveBeenLastCalledWith(BOB, {read: true});
		stop();
	});

	it('shows a rejected conversation without answering it: looking does not accept it', () => {
		const {services} = fakeServices([], {
			step: 'Fetched',
			address: ME,
			conversations: [
				conversationWith(BOB, {
					status: 'rejected',
					lastReadSeq: 0,
					lastSeq: 1,
					lastMessageAt: 1,
				}),
			],
			numUnread: 0,
			numUnaccepted: 0,
		});
		const panel = createMessagingPanel(services);
		const stop = panel.conversationView.subscribe(() => {});
		panel.openConversation(BOB);
		expect(get(panel.conversationView)?.accepted).toBe(false);
		expect(services.conversation).toHaveBeenLastCalledWith(BOB, {read: false});
		stop();
	});

	it('opens no conversation store before the inbox answered, so looking cannot accept a request', () => {
		const {services, list} = fakeServices([], {step: 'Fetching', address: ME});
		const panel = createMessagingPanel(services);
		const stop = panel.conversationView.subscribe(() => {});
		panel.openConversation(BOB);
		expect(get(panel.conversationView)).toBeUndefined();
		expect(services.conversation).not.toHaveBeenCalled();

		// the list answers: BOB wrote first, so it is a request, read without answering
		list.set(fetched([BOB]));
		expect(get(panel.conversationView)?.accepted).toBe(false);
		expect(services.conversation).toHaveBeenCalledTimes(1);
		expect(services.conversation).toHaveBeenLastCalledWith(BOB, {read: false});
		stop();
	});

	it('goes back to the inbox once a conversation is rejected, and shows a failure', async () => {
		const {services} = fakeServices([BOB]);
		const panel = createMessagingPanel(services);
		panel.openConversation(BOB);
		await panel.reject(BOB);
		expect(services.reject).toHaveBeenCalledWith(BOB);
		expect(get(panel).view).toEqual({kind: 'direct'});

		services.accept.mockRejectedValueOnce(new Error('missiv is down'));
		await panel.accept(BOB);
		expect(get(panel).error).toBe('missiv is down');
		panel.dismissError();
		expect(get(panel).error).toBeUndefined();
	});

	it('has no inbox when messaging is not configured', () => {
		const panel = createMessagingPanel(undefined);
		expect(panel.inbox).toBeUndefined();
		panel.openConversation(BOB);
		expect(get(panel.conversationView)).toBeUndefined();
	});
});

// QA F15: a room message's author opens a direct conversation
describe('roomAuthorToMessage', () => {
	const me = '0xAbCdEf0000000000000000000000000000000001';
	const other = '0x00000000000000000000000000000000000000AA';
	it('is the author, lower case, for another account', () => {
		expect(roomAuthorToMessage(other, me)).toBe(other.toLowerCase());
	});
	it('is nothing for my own message, whatever the case', () => {
		expect(roomAuthorToMessage(me.toLowerCase(), me)).toBeUndefined();
	});
	it('is the author when I am not registered', () => {
		expect(roomAuthorToMessage(me, undefined)).toBe(me.toLowerCase());
	});
});

describe('createComposer', () => {
	it('sends trimmed text once at a time, and keeps a refusal on the store', async () => {
		let release: () => void = () => {};
		const send = vi.fn(
			() => new Promise<void>((resolve) => (release = resolve)),
		);
		const composer = createComposer(send);
		const first = composer.submit('  hi  ');
		expect(get(composer).sending).toBe(true);
		expect(await composer.submit('again')).toBe(false);
		release();
		expect(await first).toBe(true);
		expect(send).toHaveBeenCalledWith('hi');
		expect(send).toHaveBeenCalledTimes(1);
		expect(await composer.submit('   ')).toBe(false);

		send.mockRejectedValueOnce(new Error('no key yet'));
		expect(await composer.submit('x')).toBe(false);
		expect(get(composer)).toEqual({sending: false, error: 'no key yet'});
	});
});

// QA F19: missiv's DM push leads to the app's root with the ids in
// `data.missiv`; the app opens the conversation from them.
describe('conversationFromNotification', () => {
	const app = {domain: 'app.example', namespace: 'demo'};
	const push = (missiv: object) => ({
		navigate: 'https://app.example/',
		missiv: {
			type: 'message',
			domain: 'app.example',
			namespace: 'demo',
			conversationID: 'id',
			messageID: 'm1',
			sender: BOB.toUpperCase().replace('0X', '0x'),
			...missiv,
		},
	});

	it('is the sender of a missiv message pushed for this app, in lower case', () => {
		expect(conversationFromNotification(push({}), app)).toEqual({
			with: BOB,
			recipient: undefined,
		});
	});

	it('is undefined for another notification, app, namespace or kind, or a malformed sender', () => {
		expect(conversationFromNotification(undefined, app)).toBeUndefined();
		expect(
			conversationFromNotification({navigate: 'demo'}, app),
		).toBeUndefined();
		expect(
			conversationFromNotification(push({domain: 'other.example'}), app),
		).toBeUndefined();
		expect(
			conversationFromNotification(push({namespace: 'other'}), app),
		).toBeUndefined();
		expect(
			conversationFromNotification(push({type: 'reaction'}), app),
		).toBeUndefined();
		expect(
			conversationFromNotification(push({sender: 'bob'}), app),
		).toBeUndefined();
	});
});

// QA F23: missiv 0.5 names the recipient, and where the worker never runs
// the page reads a hand-off (`{missiv: {type, namespace, conversationID,
// recipient}}`, no domain, no sender) from the push's URL.
describe('conversationFromNotification, missiv 0.5', () => {
	const app = {domain: 'app.example', namespace: 'demo'};
	const ALICE = '0x00000000000000000000000000000000000000aa';
	const handoff = (missiv: object = {}) => ({
		missiv: {
			type: 'message',
			namespace: 'demo',
			conversationID: getConversationID(ALICE, BOB),
			recipient: ALICE,
			...missiv,
		},
	});

	it('names the recipient of a worker click', () => {
		const data = {
			missiv: {
				type: 'message',
				domain: 'app.example',
				namespace: 'demo',
				conversationID: getConversationID(ALICE, BOB),
				messageID: 'm',
				sender: BOB,
				recipient: ALICE.replace('0x', '0X').replace('0X', '0x'),
			},
		};
		expect(conversationFromNotification(data, app)).toEqual({
			with: BOB,
			recipient: ALICE,
		});
	});

	it('reads a hand-off: the other member is the half of the conversation id that is not the recipient', () => {
		expect(conversationFromNotification(handoff(), app)).toEqual({
			with: BOB,
			recipient: ALICE,
		});
		expect(
			conversationFromNotification(handoff({recipient: BOB}), app),
		).toEqual({with: ALICE, recipient: BOB});
	});

	it('is undefined for a hand-off of another namespace, a recipient not in it, or a group', () => {
		expect(
			conversationFromNotification(handoff({namespace: 'other'}), app),
		).toBeUndefined();
		expect(
			conversationFromNotification(handoff({recipient: CAROL}), app),
		).toBeUndefined();
		expect(
			conversationFromNotification(
				handoff({conversationID: '0x' + 'ab'.repeat(32)}),
				app,
			),
		).toBeUndefined();
		expect(
			conversationFromNotification(handoff({type: 'reaction'}), app),
		).toBeUndefined();
	});
});

describe('openConversationsFromClicks', () => {
	const app = {domain: 'app.example', namespace: 'demo'};
	const dm = (sender: string) => ({
		missiv: {
			type: 'message',
			domain: 'app.example',
			namespace: 'demo',
			conversationID: 'id',
			messageID: 'm',
			sender,
		},
	});

	it('opens each clicked DM once, the click already there included, and ignores the others', () => {
		const clicks = writable<{id: number; data?: unknown} | undefined>({
			id: 1,
			data: dm(BOB),
		});
		const panel = {openConversation: vi.fn()};
		const stop = openConversationsFromClicks(clicks, panel, app);
		expect(panel.openConversation).toHaveBeenCalledWith(BOB);

		clicks.set({id: 2, data: {navigate: 'demo'}});
		clicks.set({id: 2, data: dm(CAROL)});
		expect(panel.openConversation).toHaveBeenCalledTimes(1);

		clicks.set({id: 3, data: dm(CAROL)});
		expect(panel.openConversation).toHaveBeenLastCalledWith(CAROL);
		expect(panel.openConversation).toHaveBeenCalledTimes(2);
		stop();
	});
});

describe('openConversationsFromClicks, for another account (QA F23)', () => {
	const app = {domain: 'app.example', namespace: 'demo'};
	const ALICE = '0x00000000000000000000000000000000000000aa';
	const handoff = (recipient: string) => ({
		missiv: {
			type: 'message',
			namespace: 'demo',
			conversationID: getConversationID(ALICE, BOB),
			recipient,
		},
	});

	function setup(account: string | undefined) {
		const clicks = writable<{id: number; data?: unknown} | undefined>(
			undefined,
		);
		const connected = writable<string | undefined>(account);
		const panel = {openConversation: vi.fn()};
		const onOtherAccount = vi.fn();
		const stop = openConversationsFromClicks(clicks, panel, app, {
			account: connected,
			onOtherAccount,
			waitMs: 1000,
		});
		return {clicks, connected, panel, onOtherAccount, stop};
	}

	it('opens a DM for the connected account, and hands one for another to onOtherAccount', () => {
		const s = setup(ALICE.toUpperCase().replace('0X', '0x'));
		s.clicks.set({id: 1, data: handoff(ALICE)});
		expect(s.panel.openConversation).toHaveBeenCalledWith(BOB);

		s.clicks.set({id: 2, data: handoff(BOB)});
		expect(s.onOtherAccount).toHaveBeenCalledWith({
			recipient: BOB,
			with: ALICE,
			connected: ALICE,
		});
		expect(s.panel.openConversation).toHaveBeenCalledTimes(1);
		s.stop();
	});

	it('with no account yet, waits for the connection to come back before deciding', () => {
		vi.useFakeTimers();
		try {
			const s = setup(undefined);
			s.clicks.set({id: 1, data: handoff(ALICE)});
			expect(s.panel.openConversation).not.toHaveBeenCalled();
			s.connected.set(ALICE);
			expect(s.panel.openConversation).toHaveBeenCalledWith(BOB);

			// none comes: decided with none, said for the recipient
			s.connected.set(undefined);
			s.clicks.set({id: 2, data: handoff(ALICE)});
			vi.advanceTimersByTime(1000);
			expect(s.onOtherAccount).toHaveBeenCalledWith({
				recipient: ALICE,
				with: BOB,
				connected: undefined,
			});
			// and an account arriving later changes nothing
			s.connected.set(ALICE);
			expect(s.panel.openConversation).toHaveBeenCalledTimes(1);
			s.stop();
		} finally {
			vi.useRealTimers();
		}
	});
});
