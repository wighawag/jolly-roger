/**
 * MESSAGING (`with/messaging`): a global chat and direct messages, on missiv.
 *
 * One store says where the account stands with missiv (not configured, no
 * account, not registered yet, registered), and `services` holds missiv's own
 * stores (`@missiv/client`), each built ONCE here and working only while
 * something is subscribed to it:
 *
 * - `room`: the domain's room (`@<domain>`), unencrypted, read by anyone, written
 *   by a registered account once logged in (automatic);
 * - `conversations`: the account's direct-message conversations;
 * - `conversation(address)`: one direct conversation, each message encrypted to
 *   the other's key set once it is verified against their wallet's publication
 *   signature; `accept(address)` and `reject(address)` (reject blocks the
 *   sender in the domain).
 *
 * The conversation stores share missiv's LIVE INBOX (missiv 0.6): one channel
 * per account, on a socket, or polling `inbox/changes` when the socket keeps
 * failing or the deployment offers none (`inboxTransport`, `auto` by default);
 * no store polls by itself.
 *
 * THE IDENTITY is the one `with/push-notifications` uses: the wallet, the key
 * set `@etherplay/connect` derives for this app (`account.keySet`, an Ed25519
 * signing key and an X25519 encryption key), and the wallet's signature over
 * the key set's publication message. missiv's `register` needs that signature,
 * and `signOwnership` (connect's `getSignatureForPublicKeyPublication`) answers
 * it from the account when connect already holds it (a hosted account, or a
 * wallet that answered once, which connect keeps), so the wallet is asked at
 * most once for messaging and notifications together. Registration happens on
 * first use (`register()`), never on a page load.
 *
 * A DM notifies its recipient by Web Push through missiv itself (its server calls
 * the push server for the recipient's wallet), reaching every device the account
 * registered with "notify me": nothing to register here.
 *
 * With no `config` (`PUBLIC_MISSIV` unset, R2 of the service-layers spec) the
 * store is `{status: 'not-configured'}` and there are no services.
 */
import {derived, get, readable, writable, type Readable} from 'svelte/store';
import {
	API,
	createMissivRegistration,
	openConversationList,
	openOneConversation,
	openRoom,
	type Account,
	type ConversationListStore,
	type CreateInboxSocket,
	type CurrentConversation,
	type InboxTransportOption,
	type MissivRegistration,
	type RoomSocket,
} from '@missiv/client';
import {getConversationID} from '@missiv/common';
import {originPublicKeyPublicationMessage} from 'delegated-identity';
import {
	createMessagingPanel,
	openConversationsFromClicks,
	type MessagingPanel,
	type NotificationClickLike,
} from './panel';
import {createOtherAccountNotices} from './other-account';
import type {NotificationToAdd} from '$lib/core/notifications';

/** An error as missiv's stores show it. */
export type StoreError = {message: string; code?: string; cause?: unknown};

export type MessagingConfig = {
	/** missiv's origin (its HTTP API under `/api`, its rooms' sockets beside it) */
	endpoint: string;
	/** the app's host, which missiv names the domain by (`localhost:5173`) */
	domain: string;
	/** the app's origin, which the wallet's publication signature names; its host is `domain` */
	appOrigin: string;
	/** the app's conversations within the domain */
	namespace: string;
};

export type MessagingState =
	| {status: 'not-configured'}
	/** off the browser (a server render), or the account's registration being fetched */
	| {status: 'loading'; error?: StoreError}
	| {status: 'no-account'}
	| {
			status: 'unregistered';
			registering: boolean;
			/** another key of this account is registered (another device): registering replaces it */
			otherKey: boolean;
			error?: StoreError;
	  }
	| {status: 'registered'; address: `0x${string}`; error?: StoreError};

export type Room = ReturnType<typeof openRoom>;

export type MessagingServices = {
	room: Room;
	conversations: ConversationListStore;
	/**
	 * One direct conversation, the same store for the same address and `read`.
	 * With `read` (the default), showing it accepts it and marks it read; a
	 * request is shown with `read: false` until `accept`, so looking at it
	 * answers nothing.
	 */
	conversation(
		address: `0x${string}`,
		options?: {read?: boolean},
	): CurrentConversation;
	/** Accept a conversation request: it then counts as unread, not as a request. */
	accept(address: `0x${string}`): Promise<void>;
	/** Reject a conversation: its sender is blocked from reaching this account here. */
	reject(address: `0x${string}`): Promise<void>;
};

export type Messaging = Readable<MessagingState> & {
	/**
	 * Registers this account's key set at missiv (asks the wallet at most
	 * once). Never rejects: a refusal, the wallet's included, is the state's `error`.
	 */
	register(): Promise<void>;
	/**
	 * Gets an account, the way a send does (connect's `ensureConnected`): what
	 * the panel offers at `no-account` (QA F13). Never rejects: a cancel is no
	 * error, and the connection flow shows its own failures.
	 */
	signIn(): Promise<void>;
	/** missiv's stores; undefined when messaging is not configured, or off the browser */
	services: MessagingServices | undefined;
	/** the panel's state (which view, the inbox, the conversation shown), for the shell and the pages */
	panel: MessagingPanel;
};

export type MessagingOptions = {
	/** undefined when missiv is not configured; `'off-browser'` in a server render (shown loading) */
	config: MessagingConfig | 'off-browser' | undefined;
	/** missiv's account: the wallet (lower case) and its key set in the app */
	account: Readable<Account>;
	/** the wallet's signature over the publication message: connect's, asked at most once */
	signOwnership: (address: string, message: string) => Promise<`0x${string}`>;
	/** connect's `ensureConnected()`, to the app's target step: see `signIn` */
	signIn?: () => Promise<unknown>;
	fetch?: typeof fetch;
	createWebSocket?: (url: string) => RoomSocket;
	/** how the live inbox channel's socket is made (a test's) */
	createInboxSocket?: CreateInboxSocket;
	/**
	 * how the live inbox reaches missiv: its socket, polling, or `auto` (the
	 * default: the socket, polling when it keeps failing)
	 */
	inboxTransport?: InboxTransportOption;
	/** milliseconds between two polls of the live inbox, when it polls (missiv's default 5 s) */
	inboxPollIntervalMs?: number;
	/**
	 * Clicks on this app's notifications (`serviceWorker.notificationClicks`):
	 * a direct message's push opens its conversation in the panel (QA F19).
	 */
	notificationClicks?: Readable<NotificationClickLike | undefined>;
	/**
	 * A clicked DM for another account than the one connected (QA F23): the
	 * app's notification to show it in, and connect's `connectToAddress` to
	 * switch to its recipient. Without it such a click opens nothing.
	 */
	otherAccount?: {
		notify: (notification: NotificationToAdd) => void;
		connectTo: (address: `0x${string}`) => void;
	};
};

/** The room of a domain, at missiv's origin: `ws(s)://<missiv>/api/public/room/@<domain>/ws`. */
export function roomURL(config: Pick<MessagingConfig, 'endpoint' | 'domain'>) {
	return `${config.endpoint.replace(/^http/, 'ws')}/api/public/room/@${config.domain}/ws`;
}

function stateOf(registration: MissivRegistration): MessagingState {
	switch (registration.step) {
		case 'Idle':
			return {status: 'no-account'};
		case 'Fetching':
			return {status: 'loading', error: registration.error};
		case 'Unregistered':
			return {
				status: 'unregistered',
				registering: registration.registering,
				otherKey: !!registration.otherKey,
				error: registration.error,
			};
		case 'Registered':
			return {
				status: 'registered',
				address: registration.address,
				error: registration.error,
			};
	}
}

export function createMessaging(options: MessagingOptions): Messaging {
	const config = options.config;
	if (!config || config === 'off-browser') {
		const state = readable<MessagingState>(
			config ? {status: 'loading'} : {status: 'not-configured'},
		);
		return {
			subscribe: state.subscribe,
			register: async () => {},
			signIn: async () => {},
			services: undefined,
			panel: createMessagingPanel(undefined),
		};
	}
	const {endpoint, domain, namespace, appOrigin} = config;
	const fetchOption = options.fetch ? {fetch: options.fetch} : {};
	// the live inbox channel's options, shared by the conversation stores
	const inboxOptions = {
		...(options.createInboxSocket
			? {createWebSocket: options.createInboxSocket}
			: {}),
		...(options.inboxTransport ? {transport: options.inboxTransport} : {}),
		...(options.inboxPollIntervalMs
			? {pollIntervalMs: options.inboxPollIntervalMs}
			: {}),
	};

	const registration = createMissivRegistration({
		endpoint,
		domain,
		appOrigin,
		account: options.account,
		...fetchOption,
	});
	const api = new API(
		endpoint,
		options.fetch ? {fetch: options.fetch} : undefined,
	);

	// the account the registration's store last saw (a store works only while subscribed)
	let current: MissivRegistration = {step: 'Idle', domain};
	// a refusal before missiv was reached (the wallet declined), for the account it was about
	const declined = writable<
		{of: MissivRegistration; error: StoreError} | undefined
	>(undefined);
	const state = derived(
		[registration, declined] as const,
		([$registration, $declined]) => {
			current = $registration;
			const own = stateOf($registration);
			return $declined?.of.step === 'Unregistered' &&
				$registration.step === 'Unregistered' &&
				!$registration.error &&
				$declined.of.address === $registration.address
				? {...own, error: $declined.error}
				: own;
		},
	);

	const room = openRoom({
		url: roomURL(config),
		registration,
		autoLogin: true,
		createWebSocket: options.createWebSocket,
	});
	const conversations = openConversationList({
		registration,
		endpoint,
		domain,
		namespace,
		...inboxOptions,
		...fetchOption,
	});

	const opened = new Map<string, CurrentConversation>();
	function conversation(
		address: `0x${string}`,
		mode?: {read?: boolean},
	): CurrentConversation {
		const other = address.toLowerCase() as `0x${string}`;
		const read = mode?.read ?? true;
		const key = `${other}:${read}`;
		let store = opened.get(key);
		if (!store) {
			store = openOneConversation({
				registration,
				endpoint,
				domain,
				namespace,
				otherUser: {address: other},
				markAsAcceptedAndRead: read,
				...inboxOptions,
				...fetchOption,
			});
			opened.set(key, store);
		}
		return store;
	}

	// the registration as it is now, whether or not anything is subscribed
	function now(): MissivRegistration {
		current = get(registration);
		return current;
	}

	function registered() {
		const current = now();
		if (current.step !== 'Registered') {
			throw new Error('not registered with missiv');
		}
		return current;
	}

	const services: MessagingServices = {
		room,
		conversations,
		conversation,
		async accept(address) {
			const {address: me, keySet} = registered();
			await api.accept(
				{
					type: 'accept',
					domain,
					namespace,
					conversationID: getConversationID(me, address),
				},
				{privateKey: keySet.signing.privateKey},
			);
		},
		async reject(address) {
			const {address: me, keySet} = registered();
			await api.reject(
				{
					type: 'reject',
					domain,
					namespace,
					conversationID: getConversationID(me, address),
				},
				{privateKey: keySet.signing.privateKey},
			);
		},
	};

	const panel = createMessagingPanel(services);
	// for the app's lifetime, like the services: built once, in the app's composition
	if (options.notificationClicks) {
		const otherAccount = options.otherAccount;
		openConversationsFromClicks(
			options.notificationClicks,
			panel,
			{domain, namespace},
			{
				account: derived(options.account, ($account) => $account?.address),
				onOtherAccount: otherAccount
					? createOtherAccountNotices({
							notify: otherAccount.notify,
							connectTo: otherAccount.connectTo,
							account: options.account,
							open: (address) => panel.openConversation(address),
						})
					: () => {},
			},
		);
	}

	return {
		subscribe: state.subscribe,
		services,
		panel,
		async signIn() {
			try {
				await options.signIn?.();
			} catch {
				// a cancel is not an error, and the connection flow shows a failure
			}
		},
		async register() {
			const of = now();
			if (of.step !== 'Unregistered' || of.registering) {
				return;
			}
			const {address, keySet} = of;
			const message = originPublicKeyPublicationMessage(appOrigin, keySet);
			declined.set(undefined);
			let signature: `0x${string}`;
			try {
				signature = await options.signOwnership(address, message);
			} catch (cause) {
				declined.set({
					of,
					error: {
						message: `the wallet did not sign: ${cause instanceof Error ? cause.message : String(cause)}`,
						cause,
					},
				});
				return;
			}
			// the account (or its key set) changed while the wallet signed: the
			// signature is for a key set no longer in use
			const after = now();
			if (
				after.step !== 'Unregistered' ||
				after.address !== address ||
				after.keySet.signing.privateKey !== keySet.signing.privateKey
			) {
				return;
			}
			// missiv's refusal is on the registration's own state
			await registration
				.register(signature.toLowerCase() as `0x${string}`)
				.catch(() => {});
		},
	};
}
