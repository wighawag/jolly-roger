import {describe, expect, it, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import type {ConversationList, CurrentConversation} from '@missiv/client';
import {
	createComposer,
	createMessagingPanel,
	inboxOf,
} from '$lib/messaging/panel.js';
import type {MessagingServices} from '$lib/messaging/messaging.js';

const ME = '0x00000000000000000000000000000000000000aa';
const BOB = '0x00000000000000000000000000000000000000bb';
const CAROL = '0x00000000000000000000000000000000000000cc';

function conversationWith(
	other: string,
	fields: {accepted: boolean; lastRead: number; lastMessage: number},
) {
	return {
		domain: 'app.example',
		namespace: 'demo',
		user: ME as `0x${string}`,
		conversationID: `${other}${ME}`,
		members: [ME, other] as `0x${string}`[],
		...fields,
	};
}

describe('inboxOf', () => {
	it('names the other member of each conversation, newest first, and counts unread and requests', () => {
		const list: ConversationList = {
			step: 'Fetched',
			address: ME,
			conversations: [
				conversationWith(BOB, {accepted: true, lastRead: 5, lastMessage: 9}),
				conversationWith(CAROL, {
					accepted: false,
					lastRead: 0,
					lastMessage: 12,
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
		});
	});

	it('is the list step before it is fetched', () => {
		expect(inboxOf({step: 'Idle'})).toEqual({step: 'Idle'});
		expect(inboxOf({step: 'Fetching', address: ME})).toEqual({
			step: 'Fetching',
		});
	});
});

function fakeServices(conversations: string[] = []) {
	const list = writable<ConversationList>({
		step: 'Fetched',
		address: ME,
		conversations: conversations.map((other) =>
			conversationWith(other, {accepted: false, lastRead: 0, lastMessage: 1}),
		),
		numUnread: 0,
		numUnaccepted: conversations.length,
	});
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
