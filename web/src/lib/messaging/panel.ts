/**
 * THE MESSAGING PANEL'S STATE, so its components only render it: which view is
 * open (the room, the direct messages, one conversation), the inbox derived from
 * missiv's conversation list, the conversation being shown with the right
 * reading mode, and the actions with their failures.
 *
 * Shared by the shell's panel and any page that opens a conversation (the demo:
 * a greeting's author), hence a store rather than a component's own state.
 */
import {derived, get, writable, type Readable} from 'svelte/store';
import type {ConversationList, CurrentConversation} from '@missiv/client';
import type {MessagingServices} from './messaging';

export type PanelView =
	| {kind: 'room'}
	| {kind: 'direct'}
	| {kind: 'conversation'; address: `0x${string}`};

export type PanelState = {
	open: boolean;
	view: PanelView;
	/** the last action that failed (accept, reject), until dismissed */
	error?: string;
};

/** A direct conversation as the inbox lists it: the other member, and where it stands. */
export type InboxItem = {
	address: `0x${string}`;
	/** false for a request: someone wrote first, not answered yet */
	accepted: boolean;
	/** accepted, with a message newer than the last read */
	unread: boolean;
	lastMessage: number;
};

export type Inbox =
	| {step: 'Idle' | 'Fetching'}
	| {
			step: 'Fetched';
			items: InboxItem[];
			/** what the panel's badge counts: unread conversations and requests */
			count: number;
	  };

/** The conversation the panel shows, read with the mode its acceptance calls for. */
export type ConversationView = {
	address: `0x${string}`;
	/** false while it is a request: shown without answering, with accept and reject */
	accepted: boolean;
	conversation: CurrentConversation;
};

export type MessagingPanel = Readable<PanelState> & {
	/** undefined when messaging is not configured */
	inbox: Readable<Inbox> | undefined;
	conversationView: Readable<ConversationView | undefined>;
	toggle(): void;
	close(): void;
	show(view: PanelView): void;
	/** open the panel on a direct conversation with `address` */
	openConversation(address: `0x${string}`): void;
	accept(address: `0x${string}`): Promise<void>;
	/** blocks the sender here, and goes back to the inbox */
	reject(address: `0x${string}`): Promise<void>;
	dismissError(): void;
};

const lower = (address: string) => address.toLowerCase() as `0x${string}`;

/** The inbox of a conversation list: the other member of each conversation, newest first. */
export function inboxOf(list: ConversationList): Inbox {
	if (list.step !== 'Fetched') {
		return {step: list.step};
	}
	const me = lower(list.address);
	const items = list.conversations
		.map((conversation) => ({
			address: lower(
				conversation.members.find((member) => lower(member) !== me) ?? me,
			),
			accepted: conversation.accepted,
			unread:
				conversation.accepted &&
				conversation.lastRead < conversation.lastMessage,
			lastMessage: conversation.lastMessage,
		}))
		.sort((a, b) => b.lastMessage - a.lastMessage);
	return {
		step: 'Fetched',
		items,
		count: list.numUnread + list.numUnaccepted,
	};
}

export function createMessagingPanel(
	services: MessagingServices | undefined,
): MessagingPanel {
	const state = writable<PanelState>({open: false, view: {kind: 'room'}});
	// accepted here since the list was last fetched (it is polled)
	const acceptedHere = writable(new Set<string>());

	const inbox = services ? derived(services.conversations, inboxOf) : undefined;

	const conversationView = derived(
		[state, inbox ?? writable<Inbox>({step: 'Idle'}), acceptedHere] as const,
		([$state, $inbox, $acceptedHere]): ConversationView | undefined => {
			if (!services || $state.view.kind !== 'conversation') {
				return undefined;
			}
			const address = $state.view.address;
			const item =
				$inbox.step === 'Fetched'
					? $inbox.items.find((i) => i.address === address)
					: undefined;
			// a conversation not in the list yet is one this account starts
			const accepted = !item || item.accepted || $acceptedHere.has(address);
			return {
				address,
				accepted,
				conversation: services.conversation(address, {read: accepted}),
			};
		},
	);

	function fail(error: unknown) {
		state.update((s) => ({
			...s,
			error: error instanceof Error ? error.message : String(error),
		}));
	}

	return {
		subscribe: state.subscribe,
		inbox,
		conversationView,
		toggle() {
			state.update((s) => ({...s, open: !s.open}));
		},
		close() {
			state.update((s) => ({...s, open: false}));
		},
		show(view) {
			state.update((s) => ({...s, open: true, view, error: undefined}));
		},
		openConversation(address) {
			state.update((s) => ({
				...s,
				open: true,
				view: {kind: 'conversation', address: lower(address)},
				error: undefined,
			}));
		},
		async accept(address) {
			if (!services) return;
			try {
				await services.accept(address);
				acceptedHere.update((set) => new Set(set).add(lower(address)));
			} catch (error) {
				fail(error);
			}
		},
		async reject(address) {
			if (!services) return;
			try {
				await services.reject(address);
				if (get(state).view.kind === 'conversation') {
					state.update((s) => ({...s, view: {kind: 'direct'}}));
				}
			} catch (error) {
				fail(error);
			}
		},
		dismissError() {
			state.update((s) => ({...s, error: undefined}));
		},
	};
}

export type Composer = Readable<{sending: boolean; error?: string}> & {
	/** sends `text`; true once sent, false when refused (the error is on the store) */
	submit(text: string): Promise<boolean>;
	dismissError(): void;
};

/** A message box's sending state: one send at a time, its failure shown. */
export function createComposer(
	send: (text: string) => Promise<void>,
): Composer {
	const state = writable<{sending: boolean; error?: string}>({sending: false});
	return {
		subscribe: state.subscribe,
		async submit(text) {
			const trimmed = text.trim();
			if (!trimmed || get(state).sending) return false;
			state.set({sending: true});
			try {
				await send(trimmed);
				state.set({sending: false});
				return true;
			} catch (error) {
				state.set({
					sending: false,
					error: error instanceof Error ? error.message : String(error),
				});
				return false;
			}
		},
		dismissError() {
			state.update((s) => ({...s, error: undefined}));
		},
	};
}
