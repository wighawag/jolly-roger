// The "notify me" toggle's store against the two real services, in process:
// push-notification-server's Node.js platform (`createNodeServer` on in-memory
// libSQL) and the trigger service's registration API (`createTriggerService`
// with delegated-identity's verifier), each reached through its app's
// `request`, so no port. The browser's PushManager is a fake.
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {get, writable, type Readable} from 'svelte/store';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {createNodeServer} from '@push-notification/cli';
import {
	canonicalFeed,
	createTriggerService,
	delegatedIdentityVerifier,
	openDatabase,
	pushAction,
	type TriggerService,
} from '@etherfold/platform-nodejs-triggers';
import {
	createNotifications,
	type NotificationsConfig,
	type NotificationsState,
	type NotifiedAccount,
	type PushServiceWorker,
} from '$lib/push/notifications.js';
import {
	greetingTriggers,
	NEW_GREETING,
} from '$lib/onchain/notifier/greetings.js';
import {
	delegatePublicKey,
	originPublicKeyPublicationMessage,
} from 'delegated-identity';

const APP = 'https://greetings.example';
const PUSH = 'https://push.example';
const NOTIFIER = 'https://notifier.example';
const TOKEN = 'the-notifier-token';
const REGISTRY = '0x0000000000000000000000000000000000000001';

const config: NotificationsConfig = {
	pushServer: `${PUSH}/api`,
	vapidPublicKey:
		'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
	notifier: NOTIFIER,
	domain: APP,
};

async function sha256Hex(text: string) {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(text),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

let devices = 0;
function fakeBrowser() {
	let subscription: {endpoint: string; toJSON(): unknown} | null = null;
	let permission: NotificationPermission = 'default';
	const registration = {
		pushManager: {
			getSubscription: async () => subscription,
			subscribe: vi.fn(async () => {
				permission = 'granted';
				const endpoint = `https://push.invalid/device-${++devices}`;
				subscription = {
					endpoint,
					toJSON: () => ({
						endpoint,
						expirationTime: null,
						keys: {p256dh: 'p256dh', auth: 'auth'},
					}),
				};
				return subscription;
			}),
		},
	};
	return {
		registration: registration as unknown as ServiceWorkerRegistration,
		permission: () => permission,
	};
}

function until(
	store: Readable<NotificationsState>,
	predicate: (state: NotificationsState) => boolean,
): Promise<NotificationsState> {
	return new Promise((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		const timeout = setTimeout(() => {
			unsubscribe?.();
			reject(new Error(`timed out at ${JSON.stringify(get(store))}`));
		}, 3000);
		unsubscribe = store.subscribe((state) => {
			if (predicate(state)) {
				clearTimeout(timeout);
				queueMicrotask(() => unsubscribe?.());
				resolve(state);
			}
		});
	});
}
const settled = (state: NotificationsState) =>
	state.status !== 'not-configured' &&
	state.status !== 'loading' &&
	!state.busy &&
	state.trigger !== 'checking';

describe('createNotifications, against the push server and the trigger service in process', () => {
	let push: Awaited<ReturnType<typeof createNodeServer>>;
	let triggers: TriggerService;
	let now: number;

	beforeEach(async () => {
		push = await createNodeServer({
			db: ':memory:',
			env: {
				VAPID_PUBLIC_KEY: '',
				VAPID_PRIVATE_KEY: '',
				PUSH_TOKENS: `${APP}:${await sha256Hex(TOKEN)}`,
			},
			getPushSender: () => async () => ({ok: true, status: 201}),
		});
		now = Date.now();
		triggers = createTriggerService({
			db: openDatabase({database: ':memory:'}).db,
			name: 'greetings',
			chainId: '31337',
			feed: canonicalFeed({
				url: 'http://etherfold.invalid',
				indexer: 'greetings',
			}),
			gate: async () => 0,
			definitions: greetingTriggers(REGISTRY),
			actions: {
				push: pushAction({url: `${PUSH}/api`, domain: APP, token: TOKEN}),
			},
			verifier: delegatedIdentityVerifier({
				serverOrigin: NOTIFIER,
				domain: APP,
			}),
			clock: () => now,
		});
		await triggers.setup();
	});

	const network = ((input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url.startsWith(PUSH)) return push.request(url, init);
		if (url.startsWith(NOTIFIER)) return triggers.api!.request(url, init);
		throw new Error(`no such host: ${url}`);
	}) as typeof fetch;

	// `signOwnership` stands for @etherplay/connect 0.18's
	// getSignatureForPublicKeyPublication: the wallet asked at most once, its
	// answer kept on the account (so a reload starts with it, `reloadedAccount`)
	function newAccount() {
		const wallet = privateKeyToAccount(generatePrivateKey());
		const delegatePrivateKey = generatePrivateKey();
		const walletPrompts = vi.fn(async (message: string) =>
			wallet.signMessage({message}),
		);
		let kept: `0x${string}` | undefined;
		const signOwnership = vi.fn(
			async (_address: string, message: string) =>
				(kept ??= await walletPrompts(message)),
		);
		const account: NonNullable<NotifiedAccount> = {
			address: wallet.address,
			delegatePrivateKey,
		};
		const reloadedAccount = (): NotifiedAccount => ({
			...account,
			...(kept ? {ownershipSignature: kept} : {}),
		});
		return {wallet, account, signOwnership, walletPrompts, reloadedAccount};
	}

	async function savedSignature(of: ReturnType<typeof newAccount>) {
		return of.wallet.signMessage({
			message: originPublicKeyPublicationMessage(
				APP,
				delegatePublicKey(of.account.delegatePrivateKey),
			),
		});
	}

	function toggle(
		of: ReturnType<typeof newAccount>,
		browser: ReturnType<typeof fakeBrowser>,
		account?: NotifiedAccount,
	) {
		return createNotifications({
			config,
			kind: NEW_GREETING,
			account: writable(account ?? of.account),
			serviceWorker: writable(browser.registration),
			signOwnership: of.signOwnership,
			fetch: network,
			permission: browser.permission,
			supported: () => true,
		});
	}

	async function registeredDevices(address: string) {
		const response = await push.request(
			`${PUSH}/api/registered/${address}/${encodeURIComponent(APP)}`,
			{headers: {authorization: `Bearer ${TOKEN}`}},
		);
		return ((await response.json()) as {count: number}).count;
	}
	const subscriptionsOf = async (address: string) =>
		(await triggers.registry.list(address.toLowerCase())).filter(
			(s) => s.status === 'active',
		);

	it('says it is not configured, and does nothing, when a service is missing', async () => {
		const of = newAccount();
		const notifications = createNotifications({
			config: undefined,
			kind: NEW_GREETING,
			account: writable(of.account),
			serviceWorker: writable(undefined),
			signOwnership: of.signOwnership,
		});
		expect(get(notifications)).toEqual({status: 'not-configured'});
		await notifications.enable();
		await notifications.disable();
		expect(get(notifications)).toEqual({status: 'not-configured'});
		expect(of.signOwnership).not.toHaveBeenCalled();
	});

	it('is loading, not "not configured", off the browser when the services are set', async () => {
		const of = newAccount();
		const notifications = createNotifications({
			config: 'off-browser',
			kind: NEW_GREETING,
			account: writable(of.account),
			serviceWorker: writable(undefined),
			signOwnership: of.signOwnership,
		});
		expect(get(notifications)).toEqual({
			status: 'loading',
			trigger: 'unknown',
			busy: false,
		});
		await notifications.enable();
		expect(of.signOwnership).not.toHaveBeenCalled();
	});

	it('enables both halves for the wallet: the device at the push server, the trigger at the notifier', async () => {
		const of = newAccount();
		const notifications = toggle(of, fakeBrowser());
		expect(await until(notifications, settled)).toMatchObject({status: 'off'});

		await notifications.enable();
		expect(await until(notifications, settled)).toMatchObject({
			status: 'on',
			trigger: 'on',
		});
		expect(await registeredDevices(of.wallet.address)).toBe(1);
		const subscriptions = await subscriptionsOf(of.wallet.address);
		expect(subscriptions.map((s) => s.kind)).toEqual([NEW_GREETING]);
		// one wallet prompt for both services: the trigger reuses the device's proof
		expect(of.walletPrompts).toHaveBeenCalledTimes(1);
	});

	it('asks the wallet nothing when the account already carries its ownership signature', async () => {
		const of = newAccount();
		const notifications = toggle(of, fakeBrowser(), {
			...of.account,
			ownershipSignature: await savedSignature(of),
		});
		await until(notifications, settled);
		await notifications.enable();
		expect(await until(notifications, settled)).toMatchObject({
			status: 'on',
			trigger: 'on',
		});
		expect(of.signOwnership).not.toHaveBeenCalled();
	});

	it('renews the trigger on load, without a prompt, so it does not expire while the device is on', async () => {
		const of = newAccount();
		const browser = fakeBrowser();
		const first = toggle(of, browser);
		await until(first, settled);
		await first.enable();
		await until(first, (s) => settled(s) && s.status === 'on');
		const [registered] = await subscriptionsOf(of.wallet.address);

		now += 60_000;
		const reloaded = toggle(of, browser, of.reloadedAccount());
		expect(await until(reloaded, settled)).toMatchObject({
			status: 'on',
			trigger: 'on',
		});
		const [renewed] = await subscriptionsOf(of.wallet.address);
		expect(renewed.id).toBe(registered.id);
		expect(renewed.expiresAt).toBe(registered.expiresAt + 60_000);
		expect(of.walletPrompts).toHaveBeenCalledTimes(1);
	});

	it('re-registers on load a trigger that expired', async () => {
		const of = newAccount();
		const browser = fakeBrowser();
		const first = toggle(of, browser);
		await until(first, settled);
		await first.enable();
		await until(first, (s) => settled(s) && s.status === 'on');

		now += 31 * 24 * 60 * 60 * 1000;
		await triggers.registry.expire();
		expect(await subscriptionsOf(of.wallet.address)).toEqual([]);

		const reloaded = toggle(of, browser, of.reloadedAccount());
		expect(await until(reloaded, settled)).toMatchObject({trigger: 'on'});
		expect(await subscriptionsOf(of.wallet.address)).toHaveLength(1);
	});

	it('leaves the trigger alone on load when renewing it would need a prompt', async () => {
		const of = newAccount();
		const browser = fakeBrowser();
		const first = toggle(of, browser);
		await until(first, settled);
		await first.enable();
		await until(first, (s) => settled(s) && s.status === 'on');

		// an account that carries no signature (a smart-contract wallet's, which
		// connect does not keep): the device is registered, the trigger left alone
		const reloaded = toggle(of, browser, of.account);
		expect(await until(reloaded, settled)).toMatchObject({
			status: 'on',
			trigger: 'unknown',
		});
		expect(of.walletPrompts).toHaveBeenCalledTimes(1);
	});

	it('disables both: the trigger cancelled, the device unregistered', async () => {
		const of = newAccount();
		const notifications = toggle(of, fakeBrowser());
		await until(notifications, settled);
		await notifications.enable();
		await until(notifications, (s) => settled(s) && s.status === 'on');

		await notifications.disable();
		expect(await until(notifications, settled)).toMatchObject({
			status: 'unregistered',
			trigger: 'off',
		});
		expect(await subscriptionsOf(of.wallet.address)).toEqual([]);
		expect(await registeredDevices(of.wallet.address)).toBe(0);
	});

	it('reports a refused trigger registration as an error, the device left registered', async () => {
		const of = newAccount();
		const notifications = createNotifications({
			// the notifier serves another app, so it refuses this one's proof
			config: {...config, notifier: 'https://elsewhere.example'},
			kind: NEW_GREETING,
			account: writable(of.account),
			serviceWorker: writable(fakeBrowser().registration),
			signOwnership: of.signOwnership,
			fetch: ((input: string, init?: RequestInit) =>
				String(input).startsWith('https://elsewhere.example')
					? triggers.api!.request(
							String(input).replace('https://elsewhere.example', NOTIFIER),
							init,
						)
					: network(input, init)) as typeof fetch,
			permission: () => 'granted',
			supported: () => true,
		});
		await until(notifications, settled);
		await notifications.enable();
		const state = await until(notifications, settled);
		expect(state).toMatchObject({status: 'on', trigger: 'off'});
		expect(state.status !== 'not-configured' && state.error).toBeTruthy();
		expect(await subscriptionsOf(of.wallet.address)).toEqual([]);
	});

	// QA F21: one browser, two accounts of the app. Every device registration
	// used to add up, so the device received both accounts' pushes.
	describe('one account per device', () => {
		function switchable(
			first: ReturnType<typeof newAccount>,
			browser: ReturnType<typeof fakeBrowser>,
			replaceOtherAccounts?: boolean,
		) {
			const current = writable<NotifiedAccount>(first.account);
			let signer = first;
			const notifications = createNotifications({
				config,
				kind: NEW_GREETING,
				account: current,
				serviceWorker: writable(browser.registration),
				signOwnership: (address, message) =>
					signer.signOwnership(address, message),
				fetch: network,
				permission: browser.permission,
				supported: () => true,
				replaceOtherAccounts,
			});
			return {
				notifications,
				switchTo(next: ReturnType<typeof newAccount>) {
					signer = next;
					current.set(next.account);
				},
			};
		}
		const left = (state: NotificationsState) =>
			settled(state) && state.status !== 'on';

		it('says the device is notified for another account, and enabling switches it', async () => {
			const alice = newAccount();
			const bob = newAccount();
			const {notifications, switchTo} = switchable(alice, fakeBrowser(), true);
			expect(notifications.oneAccountPerDevice).toBe(true);
			await until(notifications, settled);
			await notifications.enable();
			expect(await until(notifications, settled)).toMatchObject({
				status: 'on',
				otherAccounts: [],
			});

			switchTo(bob);
			expect(await until(notifications, left)).toMatchObject({
				status: 'unregistered',
				otherAccounts: [alice.wallet.address.toLowerCase()],
			});
			await notifications.switchHere();
			expect(await until(notifications, settled)).toMatchObject({
				status: 'on',
				trigger: 'on',
				otherAccounts: [],
			});
			expect(await registeredDevices(alice.wallet.address)).toBe(0);
			expect(await registeredDevices(bob.wallet.address)).toBe(1);

			switchTo(alice);
			expect(await until(notifications, left)).toMatchObject({
				status: 'unregistered',
				otherAccounts: [bob.wallet.address.toLowerCase()],
			});
		});

		it('without the option, keeps both, says so, and switchHere still moves the device', async () => {
			const alice = newAccount();
			const bob = newAccount();
			const {notifications, switchTo} = switchable(alice, fakeBrowser());
			expect(notifications.oneAccountPerDevice).toBe(false);
			await until(notifications, settled);
			await notifications.enable();
			await until(notifications, settled);
			switchTo(bob);
			await until(notifications, left);
			await notifications.enable();
			expect(await until(notifications, settled)).toMatchObject({
				status: 'on',
				otherAccounts: [alice.wallet.address.toLowerCase()],
			});
			expect(await registeredDevices(alice.wallet.address)).toBe(1);

			await notifications.switchHere();
			expect(await until(notifications, settled)).toMatchObject({
				status: 'on',
				otherAccounts: [],
			});
			expect(await registeredDevices(alice.wallet.address)).toBe(0);
		});
	});

	it('follows the account: none means no-account, and its trigger is never touched', async () => {
		const of = newAccount();
		const account = writable<NotifiedAccount>(undefined);
		const notifications = createNotifications({
			config,
			kind: NEW_GREETING,
			account,
			serviceWorker: writable(fakeBrowser().registration),
			signOwnership: of.signOwnership,
			fetch: network,
			permission: () => 'default',
			supported: () => true,
		});
		expect(await until(notifications, settled)).toMatchObject({
			status: 'no-account',
		});
		account.set(of.account);
		expect(
			await until(
				notifications,
				(s) => settled(s) && s.status !== 'no-account',
			),
		).toMatchObject({status: 'off', trigger: 'unknown'});
		expect(of.signOwnership).not.toHaveBeenCalled();
	});
});

// QA F13: on `pnpm start` (vite dev, no service worker) a signed-in account
// read "Sign in to be notified", because the push client says `no-account`
// for no registration too; and with no account there was nothing to click.
describe('createNotifications, before notifications can be turned on', () => {
	const noNetwork = (() => {
		throw new Error('nothing is asked of the services here');
	}) as unknown as typeof fetch;
	const someAccount = (): NonNullable<NotifiedAccount> => ({
		address: privateKeyToAccount(generatePrivateKey()).address,
		delegatePrivateKey: generatePrivateKey(),
	});
	function line(
		account: NotifiedAccount,
		worker: Readable<PushServiceWorker>,
		signIn?: () => Promise<unknown>,
	) {
		return createNotifications({
			config,
			kind: NEW_GREETING,
			account: writable(account),
			serviceWorker: worker,
			signOwnership: async () => {
				throw new Error('no signature is asked here');
			},
			signIn,
			fetch: noNetwork,
			permission: () => 'default',
			supported: () => true,
		});
	}

	it('says the worker is off in dev to a signed-in account, not to sign in', async () => {
		const notifications = line(someAccount(), writable('off-in-dev'));
		expect(
			await until(notifications, (s) => s.status === 'no-worker'),
		).toMatchObject({status: 'no-worker', worker: 'off-in-dev'});
	});

	it('says the worker did not start, when its registration failed', async () => {
		const notifications = line(someAccount(), writable('unavailable'));
		expect(
			await until(notifications, (s) => s.status === 'no-worker'),
		).toMatchObject({status: 'no-worker', worker: 'unavailable'});
	});

	it('is loading, not no-account, while a signed-in account waits for the worker', async () => {
		const worker = writable<PushServiceWorker>(undefined);
		const notifications = line(someAccount(), worker);
		const seen: string[] = [];
		const stop = notifications.subscribe((s) => seen.push(s.status));
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(seen).not.toContain('no-account');
		expect(get(notifications).status).toBe('loading');
		worker.set(fakeBrowser().registration);
		expect(await until(notifications, (s) => s.status === 'off')).toMatchObject(
			{status: 'off'},
		);
		stop();
	});

	it('is no-account with no account, whatever the worker, and signs in from there', async () => {
		const signIn = vi.fn(async () => {});
		const notifications = line(undefined, writable('off-in-dev'), signIn);
		expect(
			await until(notifications, (s) => s.status === 'no-account'),
		).toMatchObject({status: 'no-account'});
		await notifications.signIn();
		expect(signIn).toHaveBeenCalledTimes(1);
	});

	it('takes a cancelled sign-in quietly', async () => {
		const notifications = line(undefined, writable(undefined), async () => {
			throw new Error('cancelled');
		});
		await expect(notifications.signIn()).resolves.toBeUndefined();
		expect(
			await until(notifications, (s) => s.status === 'no-account'),
		).not.toHaveProperty('error');
	});
});
