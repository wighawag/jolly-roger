// The messaging store against missiv's own server, in process: the `missiv`
// package's Node.js platform (`createNodeServer` on in-memory libSQL), reached
// through its app's `request`, so no port. The accounts are real: a wallet that
// signs the publication message of its app's delegate key, as connect does.
// The room (a socket) is missiv's own store and is exercised by the e2e.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {get, writable, type Readable} from 'svelte/store';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {createNodeServer} from 'missiv';
import {
	originPublicKeyPublicationMessage,
	type Account,
	type ConversationList,
	type ConversationState,
} from '@missiv/client';
import {delegatePublicKey} from 'delegated-identity';
import {
	createMessaging,
	roomURL,
	type MessagingConfig,
	type MessagingState,
} from '$lib/messaging/messaging.js';

const APP = 'https://greetings.example';
const MISSIV = 'https://missiv.example';
const PUSH = 'https://push.example';

const config: MessagingConfig = {
	endpoint: MISSIV,
	domain: 'greetings.example',
	appOrigin: APP,
	namespace: 'demo',
};

function until<T>(
	store: Readable<T>,
	predicate: (state: T) => boolean,
	timeoutMs = 3000,
): Promise<T> {
	return new Promise((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		let done = false;
		const timeout = setTimeout(() => {
			done = true;
			unsubscribe?.();
			reject(new Error(`timed out at ${JSON.stringify(get(store))}`));
		}, timeoutMs);
		unsubscribe = store.subscribe((state) => {
			if (!done && predicate(state)) {
				done = true;
				clearTimeout(timeout);
				queueMicrotask(() => unsubscribe?.());
				resolve(state);
			}
		});
		if (done) unsubscribe();
	});
}
const hold = (store: Readable<unknown>) => store.subscribe(() => {});

describe('createMessaging, not configured', () => {
	it('says so, and has no services', () => {
		const messaging = createMessaging({
			config: undefined,
			account: writable(undefined),
			signOwnership: vi.fn(),
		});
		expect(get(messaging)).toEqual({status: 'not-configured'});
		expect(messaging.services).toBeUndefined();
	});

	it('is loading off the browser, for the page the browser then renders', () => {
		const messaging = createMessaging({
			config: 'off-browser',
			account: writable(undefined),
			signOwnership: vi.fn(),
		});
		expect(get(messaging)).toEqual({status: 'loading'});
		expect(messaging.services).toBeUndefined();
	});
});

describe('roomURL', () => {
	it("is the domain's room on missiv's socket", () => {
		expect(
			roomURL({endpoint: 'http://127.0.0.1:34007', domain: 'localhost:5173'}),
		).toBe('ws://127.0.0.1:34007/api/public/room/@localhost:5173/ws');
		expect(
			roomURL({endpoint: 'https://missiv.example', domain: 'a.example'}),
		).toBe('wss://missiv.example/api/public/room/@a.example/ws');
	});
});

describe('createMessaging, against missiv in process', () => {
	let missiv: Awaited<ReturnType<typeof createNodeServer>>;
	let pushes: {url: string; headers: Headers; body: any}[];

	beforeEach(async () => {
		pushes = [];
		missiv = await createNodeServer({
			db: ':memory:',
			env: {
				PUSH_SERVER_URL: PUSH,
				PUSH_TOKENS: 'greetings.example=missiv-token',
			},
		});
		// missiv's push notifier calls the push server with the global fetch
		const realFetch = globalThis.fetch;
		vi.stubGlobal('fetch', (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url.startsWith(PUSH)) {
				pushes.push({
					url,
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
				});
				return new Response(JSON.stringify({ok: true}), {status: 200});
			}
			return realFetch(input, init);
		}) as typeof fetch);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const network = ((input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url.startsWith(MISSIV)) return missiv.app.request(url, init);
		throw new Error(`no such host: ${url}`);
	}) as typeof fetch;

	// `signOwnership` stands for connect's getSignatureForPublicKeyPublication:
	// the wallet asked at most once, its answer kept
	function newAccount() {
		const wallet = privateKeyToAccount(generatePrivateKey());
		const delegate = generatePrivateKey();
		const walletPrompts = vi.fn(async (message: string) =>
			wallet.signMessage({message}),
		);
		let kept: `0x${string}` | undefined;
		const signOwnership = vi.fn(
			async (_address: string, message: string) =>
				(kept ??= await walletPrompts(message)),
		);
		const account: Account = {
			address: wallet.address.toLowerCase() as `0x${string}`,
			signer: {
				address: privateKeyToAccount(
					delegate,
				).address.toLowerCase() as `0x${string}`,
				privateKey: delegate,
				publicKey: delegatePublicKey(delegate),
			},
		};
		return {account, signOwnership, walletPrompts, delegate};
	}

	function messagingOf(of: ReturnType<typeof newAccount>) {
		return createMessaging({
			config,
			account: writable(of.account),
			signOwnership: of.signOwnership,
			fetch: network,
			listPollingInterval: 0.02,
			conversationPollingInterval: 0.02,
		});
	}

	async function registered(of: ReturnType<typeof newAccount>) {
		const messaging = messagingOf(of);
		const stop = hold(messaging);
		await until(messaging, (s) => s.status === 'unregistered');
		await messaging.register();
		await until(messaging, (s) => s.status === 'registered');
		return {messaging, stop};
	}

	it('is unregistered for a new account, and registers on first use with the wallet asked once', async () => {
		const alice = newAccount();
		const messaging = messagingOf(alice);
		const stop = hold(messaging);
		const state = await until(messaging, (s) => s.status === 'unregistered');
		expect(state).toMatchObject({
			status: 'unregistered',
			registering: false,
			otherKey: false,
		});
		expect(alice.signOwnership).not.toHaveBeenCalled(); // never on load

		await messaging.register();
		const done = await until(messaging, (s) => s.status === 'registered');
		expect(done).toMatchObject({
			status: 'registered',
			address: alice.account!.address,
		});
		// the publication message of THIS app's key, which connect signs
		expect(alice.signOwnership).toHaveBeenCalledWith(
			alice.account!.address,
			originPublicKeyPublicationMessage(APP, delegatePublicKey(alice.delegate)),
		);

		// a second instance (a reload) finds it registered and asks nothing
		const again = messagingOf(alice);
		const stopAgain = hold(again);
		await until(again, (s) => s.status === 'registered');
		expect(alice.walletPrompts).toHaveBeenCalledTimes(1);
		stop();
		stopAgain();
	});

	it('is no-account without one', async () => {
		const messaging = createMessaging({
			config,
			account: writable(undefined),
			signOwnership: vi.fn(),
			fetch: network,
		});
		const stop = hold(messaging);
		expect(get(messaging)).toEqual<MessagingState>({status: 'no-account'});
		stop();
	});

	it('surfaces a refused registration', async () => {
		const alice = newAccount();
		const bob = newAccount();
		// Alice's delegate key, proven by Bob's wallet: missiv refuses it
		const messaging = createMessaging({
			config,
			account: writable(alice.account),
			signOwnership: bob.signOwnership,
			fetch: network,
		});
		const stop = hold(messaging);
		await until(messaging, (s) => s.status === 'unregistered');
		await messaging.register();
		const state = get(messaging);
		expect(state.status === 'unregistered' && state.error?.code).toBe(
			'forbidden',
		);
		stop();
	});

	it('sends a direct message, encrypted, that the other reads once accepted, and pushes it to them', async () => {
		const alice = newAccount();
		const bob = newAccount();
		const a = await registered(alice);
		const b = await registered(bob);
		const bobAddress = bob.account!.address;
		const aliceAddress = alice.account!.address;

		const toBob = a.messaging.services!.conversation(bobAddress);
		expect(
			a.messaging.services!.conversation(
				bobAddress.toUpperCase().replace('0X', '0x') as `0x${string}`,
			),
		).toBe(toBob);
		const stopToBob = hold(toBob);
		await until(
			toBob,
			(c: ConversationState) => c.step === 'Fetched' && !!c.otherUser.publicKey,
		);
		await toBob.sendMessage('hello bob');

		// Bob sees a request, from Alice
		const list = b.messaging.services!.conversations;
		const stopList = hold(list);
		const requested = await until(
			list,
			(l: ConversationList) => l.step === 'Fetched' && l.numUnaccepted === 1,
		);
		expect(
			requested.step === 'Fetched' && requested.conversations[0].accepted,
		).toBe(false);

		// shown as a request, it is read without being answered
		const request = b.messaging.services!.conversation(aliceAddress, {
			read: false,
		});
		const stopRequest = hold(request);
		await until(
			request,
			(c: ConversationState) => c.step === 'Fetched' && c.messages.length === 1,
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(get(list)).toMatchObject({step: 'Fetched', numUnaccepted: 1});
		stopRequest();

		// accepted, it is a conversation, and its message reads
		await b.messaging.services!.accept(aliceAddress);
		await until(
			list,
			(l: ConversationList) => l.step === 'Fetched' && l.numUnaccepted === 0,
		);
		const fromAlice = b.messaging.services!.conversation(aliceAddress);
		const stopFromAlice = hold(fromAlice);
		const read = await until(
			fromAlice,
			(c: ConversationState) => c.step === 'Fetched' && c.messages.length === 1,
		);
		expect(read.step === 'Fetched' && read.messages[0]).toMatchObject({
			content: 'hello bob',
		});

		// one push, to Bob's wallet under the app's domain, naming no content
		await vi.waitFor(() => expect(pushes).toHaveLength(1));
		expect(pushes[0].url).toBe(`${PUSH}/api/push`);
		expect(pushes[0].headers.get('authorization')).toBe('Bearer missiv-token');
		expect(pushes[0].body).toMatchObject({
			address: bobAddress,
			domain: 'greetings.example',
			message: {
				web_push: 8030,
				notification: {title: 'New message', navigate: `${APP}/`},
			},
		});
		expect(JSON.stringify(pushes[0].body)).not.toContain('hello bob');

		stopToBob();
		stopList();
		stopFromAlice();
		a.stop();
		b.stop();
	});

	it('rejecting a conversation blocks its sender here: no new message, no push', async () => {
		const alice = newAccount();
		const bob = newAccount();
		const a = await registered(alice);
		const b = await registered(bob);
		const toBob = a.messaging.services!.conversation(bob.account!.address);
		const stopToBob = hold(toBob);
		await until(
			toBob,
			(c: ConversationState) => c.step === 'Fetched' && !!c.otherUser.publicKey,
		);
		await toBob.sendMessage('one');
		await vi.waitFor(() => expect(pushes).toHaveLength(1));

		await b.messaging.services!.reject(alice.account!.address);
		await toBob.sendMessage('two');
		const fromAlice = b.messaging.services!.conversation(
			alice.account!.address,
		);
		const stopFromAlice = hold(fromAlice);
		const seen = await until(
			fromAlice,
			(c: ConversationState) => c.step === 'Fetched',
		);
		expect(
			seen.step === 'Fetched' &&
				seen.messages.map((m) => ('content' in m ? m.content : m.error)),
		).toEqual(['one']);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(pushes).toHaveLength(1);

		stopToBob();
		stopFromAlice();
		a.stop();
		b.stop();
	});

	it('says when the wallet declines to sign, and registers on a second try', async () => {
		const alice = newAccount();
		alice.signOwnership.mockRejectedValueOnce(new Error('User rejected'));
		const messaging = messagingOf(alice);
		const stop = hold(messaging);
		await until(messaging, (s) => s.status === 'unregistered');
		await messaging.register();
		const state = get(messaging);
		expect(state.status === 'unregistered' && state.error?.message).toMatch(
			/the wallet did not sign: User rejected/,
		);
		await messaging.register();
		await until(messaging, (s) => s.status === 'registered');
		stop();
	});

	it('refuses accept and reject before registration', async () => {
		const alice = newAccount();
		const messaging = messagingOf(alice);
		const stop = hold(messaging);
		await until(messaging, (s) => s.status === 'unregistered');
		await expect(
			messaging.services!.accept(alice.account!.address),
		).rejects.toThrow(/not registered/);
		stop();
	});
});
