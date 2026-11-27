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
import {
	isUnread,
	readMissivPushHandoff,
	type MissivPushData,
} from '@missiv/common';

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
	/** the server time of its newest message (ms) */
	lastMessage: number;
};

export type Inbox =
	| {step: 'Idle' | 'Fetching'}
	| {
			step: 'Fetched';
			/** the conversations and requests, newest first; a rejected one is not listed */
			items: InboxItem[];
			/** the other members of the conversations this account rejected (blocked) */
			rejected: `0x${string}`[];
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
	/** undefined unless a conversation is open AND the inbox has answered (shown loading) */
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
	const otherOf = (members: string[]) =>
		lower(members.find((member) => lower(member) !== me) ?? me);
	const items = list.conversations
		.filter((conversation) => conversation.status !== 'rejected')
		.map((conversation) => {
			const accepted = conversation.status === 'accepted';
			return {
				address: otherOf(conversation.members),
				accepted,
				unread: accepted && isUnread(conversation),
				lastMessage: conversation.lastMessageAt,
			};
		})
		.sort((a, b) => b.lastMessage - a.lastMessage);
	const rejected = list.conversations
		.filter((conversation) => conversation.status === 'rejected')
		.map((conversation) => otherOf(conversation.members));
	return {
		step: 'Fetched',
		items,
		rejected,
		count: list.numUnread + list.numUnaccepted,
	};
}

/**
 * The author a room message offers a direct conversation with (QA F15), or
 * undefined for one's own message: writing to yourself is no conversation.
 * Only a registered account writes in the room, so `me` is the registered
 * address, when there is one.
 */
export function roomAuthorToMessage(
	from: string,
	me: string | undefined,
): `0x${string}` | undefined {
	const author = lower(from);
	return me && lower(me) === author ? undefined : author;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const isAddress = (value: unknown): value is string =>
	typeof value === 'string' && ADDRESS.test(value);

/**
 * The direct conversation a clicked notification leads to: `with`, the other
 * member, and `recipient`, the account the push is for (missiv 0.5; absent in
 * an older server's push), for THIS app's domain and namespace. Undefined for
 * any other notification (a greeting, another app's).
 *
 * Two shapes reach here, both under `missiv` (QA F23, missiv's README "Push
 * notifications"):
 * - the worker's click, `data.missiv` (`MissivPushData`): the sender is the
 *   other member (missiv pushes to every member but the sender);
 * - a hand-off the page read from its URL where the worker never runs
 *   (Safari's Declarative Web Push), `MissivPushHandoff`: no `domain` (the URL
 *   is this app's own) and no sender, so the other member is the half of the
 *   two-member `conversationID` (`getConversationID`, the two addresses
 *   concatenated) that is not the recipient. A group's id names nobody: none.
 */
export function conversationFromNotification(
	data: unknown,
	app: {domain: string; namespace: string},
): {with: `0x${string}`; recipient?: `0x${string}`} | undefined {
	const missiv = (data as {missiv?: unknown} | undefined)?.missiv;
	const handoff = readMissivPushHandoff(missiv);
	// a hand-off has no domain; a worker's data.missiv always has one
	if (handoff && (missiv as {domain?: unknown}).domain === undefined) {
		if (handoff.namespace !== app.namespace || !isAddress(handoff.recipient)) {
			return undefined;
		}
		const recipient = lower(handoff.recipient);
		const id = handoff.conversationID.toLowerCase();
		if (id.length !== 84) return undefined;
		const [a, b] = [id.slice(0, 42), id.slice(42)];
		if (!isAddress(a) || !isAddress(b)) return undefined;
		const other = a === recipient ? b : b === recipient ? a : undefined;
		return other ? {with: lower(other), recipient} : undefined;
	}
	const push = missiv as
		Partial<Record<keyof MissivPushData, unknown>> | undefined;
	if (
		!push ||
		push.type !== 'message' ||
		push.domain !== app.domain ||
		push.namespace !== app.namespace ||
		!isAddress(push.sender)
	) {
		return undefined;
	}
	return {
		with: lower(push.sender),
		recipient: isAddress(push.recipient) ? lower(push.recipient) : undefined,
	};
}

/** A click on one of this app's notifications, as `$lib/core/service-worker` publishes it. */
export type NotificationClickLike = {id: number; data?: unknown};

/** A clicked DM for an account other than the one connected (QA F23, as F22 for greetings). */
export type OtherAccountDM = {
	/** the account the push is for */
	recipient: `0x${string}`;
	/** the other member of its conversation */
	with: `0x${string}`;
	/** the account connected now, if any */
	connected: `0x${string}` | undefined;
};

/**
 * How long a click for an account waits for the connection to come back with
 * one, on a page just loaded (a tab the click opened, or a hand-off read from
 * its URL), before it is decided with none.
 */
export const ACCOUNT_WAIT_MS = 5_000;

/**
 * Open the panel on the conversation each clicked notification leads to (QA
 * F19: a DM's push opens that conversation). Every click is taken once, the one
 * already there when this subscribes included (a tab opened by the click).
 * A push for another account than the one connected (QA F23) does not open a
 * conversation that account is not in: it goes to `onOtherAccount` (the app
 * says so and offers the switch). With no account connected yet, it waits up
 * to `waitMs` for one, since a page just loaded restores its connection after
 * the click is published. Returns the unsubscribe.
 */
export function openConversationsFromClicks(
	clicks: Readable<NotificationClickLike | undefined>,
	panel: Pick<MessagingPanel, 'openConversation'>,
	app: {domain: string; namespace: string},
	accounts?: {
		/** the account connected (any case), undefined while none */
		account: Readable<string | undefined>;
		onOtherAccount: (dm: OtherAccountDM) => void;
		waitMs?: number;
	},
): () => void {
	let taken = 0;
	let pending: (() => void) | undefined;
	const stopClicks = clicks.subscribe((click) => {
		if (!click || click.id <= taken) {
			return;
		}
		taken = click.id;
		const conversation = conversationFromNotification(click.data, app);
		if (!conversation) {
			return;
		}
		const recipient = conversation.recipient;
		if (!accounts || !recipient) {
			panel.openConversation(conversation.with);
			return;
		}
		pending?.();
		const decide = (raw: string | undefined) => {
			const connected = raw ? lower(raw) : undefined;
			if (connected === recipient) {
				panel.openConversation(conversation.with);
			} else {
				accounts.onOtherAccount({
					recipient,
					with: conversation.with,
					connected,
				});
			}
		};
		const now = get(accounts.account);
		if (now) {
			decide(now);
			return;
		}
		let stop: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cancel = () => {
			stop?.();
			clearTimeout(timer);
			if (pending === cancel) pending = undefined;
		};
		pending = cancel;
		timer = setTimeout(() => {
			cancel();
			decide(undefined);
		}, accounts.waitMs ?? ACCOUNT_WAIT_MS);
		stop = accounts.account.subscribe((raw) => {
			if (!raw || pending !== cancel) return;
			cancel();
			decide(raw);
		});
	});
	return () => {
		pending?.();
		stopClicks();
	};
}

export function createMessagingPanel(
	services: MessagingServices | undefined,
): MessagingPanel {
	const state = writable<PanelState>({open: false, view: {kind: 'room'}});
	// accepted here, before the list's live inbox passed the accepted row on
	const acceptedHere = writable(new Set<string>());

	const inbox = services ? derived(services.conversations, inboxOf) : undefined;

	const conversationView = derived(
		[state, inbox ?? writable<Inbox>({step: 'Idle'}), acceptedHere] as const,
		([$panel, $inbox, $acceptedHere]): ConversationView | undefined => {
			if (!services || $panel.view.kind !== 'conversation') {
				return undefined;
			}
			// not before the list answered: whether it is a request is not known yet,
			// and opening it in the reading mode would accept it
			if ($inbox.step !== 'Fetched') {
				return undefined;
			}
			const address = $panel.view.address;
			const item = $inbox.items.find((i) => i.address === address);
			// a conversation not in the list yet is one this account starts; a
			// rejected one is not, and showing it must not accept it
			const accepted =
				$acceptedHere.has(address) ||
				(item ? item.accepted : !$inbox.rejected.includes(address));
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
