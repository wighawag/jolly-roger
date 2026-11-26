import {
	test as base,
	expect,
	describe,
	fundAddressViaHardhat,
} from '../fixtures/test';
import {createWalletClient, http, parseAbi} from 'viem';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {
	delegatePublicKey,
	originPublicKeyPublicationMessage,
	REQUEST_SIGNATURE_HEADER,
	signRequest,
} from 'delegated-identity';
import deployments from '../../src/lib/deployments';

/**
 * `with/push-notifications`, end to end: "notify me of new greetings" turned
 * on in the demo registers THIS DEVICE at the push server and the account's
 * TRIGGER at the trigger service; a greeting by another account is folded by
 * `etherfold run`, matched by the trigger service, and sent to the push server
 * as ONE push for the subscriber; that push, delivered to the service worker,
 * reaches the page.
 *
 * WHAT IS NOT REAL, and why: a headless Chromium has no push service (FCM is
 * the network) and its headless shell denies notifications whatever the
 * context grants, so `pushManager.subscribe` is stubbed with a fixed endpoint
 * and `Notification.permission` reads granted,
 * and the push server RECORDS what it would send (`/recorded`, run by
 * scripts/run-e2e-tests.sh). The recorded payload is then delivered to the
 * worker through the DevTools protocol (`ServiceWorker.deliverPushMessage`),
 * which runs the worker's real `push` handler: with the page focused it posts
 * the notification to the page, which shows it in the app's notifications.
 *
 * ITS OWN ACCOUNT (index 6) for the subscriber, which signs in and sends
 * nothing. The greeter is a fresh key funded on the chain and calling
 * GreetingsRegistry directly, so it claims no wallet account.
 */
const ENDPOINT = `https://push.invalid/e2e-${Date.now()}`;

const test = base.extend({
	page: async ({page}, use) => {
		await page.context().grantPermissions(['notifications']);
		await page.addInitScript((endpoint) => {
			// the headless shell denies notifications whatever the context grants
			const N = (globalThis as any).Notification;
			if (N) {
				Object.defineProperty(N, 'permission', {get: () => 'granted'});
				N.requestPermission = async () => 'granted';
			}
			let subscription: unknown = null;
			const proto = (globalThis as any).PushManager?.prototype;
			if (!proto) return;
			proto.getSubscription = async () => subscription;
			proto.subscribe = async () => {
				const json = {
					endpoint,
					expirationTime: null,
					keys: {p256dh: 'e2e-p256dh', auth: 'e2e-auth'},
				};
				subscription = {
					...json,
					toJSON: () => json,
					unsubscribe: async () => {
						subscription = null;
						return true;
					},
				};
				return subscription;
			};
		}, ENDPOINT);
		await use(page);
	},
});

test.use({walletAccountIndex: 6});

const PUSH_SERVER = process.env.E2E_PUSH_SERVER!;
const PUSH_TOKEN = process.env.E2E_PUSH_TOKEN!;
const RPC_URL =
	process.env.E2E_RPC_URL ||
	`http://127.0.0.1:${process.env.E2E_RPC_PORT || '8545'}`;

type Recorded = {endpoint: string; payload: any; at: number};
async function recorded(): Promise<Recorded[]> {
	const response = await fetch(`${PUSH_SERVER}/recorded`);
	return (await response.json()) as Recorded[];
}

describe('Demo Page - push notifications of new greetings', () => {
	describe.configure({mode: 'serial'});

	test.skip(!PUSH_SERVER, 'the run did not start the notifier');

	test('a greeting by another account reaches the subscriber as one push', async ({
		connectedPage,
	}) => {
		const page = connectedPage;
		const toggle = page.getByTestId('notify-me');
		await expect(toggle).toHaveAttribute(
			'data-status',
			/^(off|unregistered)$/,
			{
				timeout: 30_000,
			},
		);

		await page.getByTestId('notify-me-on').click();
		await expect(toggle).toHaveAttribute('data-status', 'on', {
			timeout: 30_000,
		});
		await expect(toggle).toHaveAttribute('data-trigger', 'on', {
			timeout: 30_000,
		});

		// the device is registered for the WALLET, under this app's origin
		const subscriber = await page.evaluate(() => {
			let value: string | undefined;
			(globalThis as any).context.account.subscribe(
				(v: string | undefined) => (value = v),
			)();
			return value;
		});
		expect(subscriber).toBeTruthy();
		const origin = new URL(page.url()).origin;
		const registered = await fetch(
			`${PUSH_SERVER}/api/registered/${subscriber}/${encodeURIComponent(origin)}`,
			{headers: {authorization: `Bearer ${PUSH_TOKEN}`}},
		);
		expect(await registered.json()).toMatchObject({registered: true, count: 1});

		// another account greets, straight to the contract
		const greeter = privateKeyToAccount(generatePrivateKey());
		await fundAddressViaHardhat(greeter.address, '1');
		const message = `Notified ${Date.now()}`;
		await createWalletClient({
			account: greeter,
			transport: http(RPC_URL),
		}).writeContract({
			chain: null,
			address: deployments.contracts.GreetingsRegistry.address,
			abi: parseAbi(['function setMessage(string message)']),
			functionName: 'setMessage',
			args: [message],
		});

		// one push, for this device, with the greeting
		await expect
			.poll(
				async () =>
					(await recorded()).filter(
						(push) =>
							push.endpoint === ENDPOINT &&
							push.payload?.notification?.body === message,
					).length,
				{timeout: 60_000, intervals: [500]},
			)
			.toBe(1);
		const push = (await recorded()).find(
			(entry) => entry.payload?.notification?.body === message,
		)!;
		expect(push.payload).toMatchObject({
			web_push: 8030,
			notification: {title: 'New greeting', navigate: 'demo'},
		});

		// delivered to the worker, the push reaches the focused page
		const cdp = await page.context().newCDPSession(page);
		const registrations: {
			registrationId: string;
			scopeURL: string;
			isDeleted: boolean;
		}[] = [];
		cdp.on('ServiceWorker.workerRegistrationUpdated', (event) =>
			registrations.push(...event.registrations),
		);
		await cdp.send('ServiceWorker.enable');
		await expect
			.poll(() =>
				registrations.some(
					(r) => !r.isDeleted && r.scopeURL.startsWith(origin),
				),
			)
			.toBe(true);
		const registration = registrations.find(
			(r) => !r.isDeleted && r.scopeURL.startsWith(origin),
		)!;
		await cdp.send('ServiceWorker.deliverPushMessage', {
			origin,
			registrationId: registration.registrationId,
			data: JSON.stringify(push.payload),
		});
		const shown = page.locator('[aria-live="assertive"]');
		await expect(shown.getByText('New greeting')).toBeVisible({
			timeout: 15_000,
		});
		await expect(shown.getByText(message)).toBeVisible();

		// and no greeting was pushed twice to this device (other suites greet on
		// the same chain, and each of theirs is one push here too)
		const bodies = (await recorded())
			.filter((entry) => entry.endpoint === ENDPOINT)
			.map((entry) => entry.payload?.notification?.body);
		expect(new Set(bodies).size).toBe(bodies.length);
	});
});

/**
 * QA F13: the notifications line when notifications cannot be turned on yet.
 * It used to read "Sign in to be notified of new greetings." with nothing to
 * click, in two different situations: no account (so: sign in, from here), and
 * an account signed in on a page with no service worker (`pnpm start`: vite dev
 * registers none), where signing in was never the answer. Neither test turns
 * notifications on, so neither registers anything for account 6.
 */
describe('Demo Page - notifications before they can be turned on', () => {
	test.skip(!PUSH_SERVER, 'the run did not start the notifier');

	test('with no account, the line signs in, then offers to notify', async ({
		page,
		connectWallet,
	}) => {
		await page.goto('/demo');
		const toggle = page.getByTestId('notify-me');
		await expect(toggle).toHaveAttribute('data-status', 'no-account', {
			timeout: 30_000,
		});
		await page.getByTestId('notify-me-sign-in').click();
		await connectWallet(page, {fund: false});
		await expect(toggle).toHaveAttribute(
			'data-status',
			/^(off|unregistered)$/,
			{timeout: 30_000},
		);
		await expect(page.getByTestId('notify-me-on')).toBeVisible();
	});
});

// A page whose service worker cannot register, as under `vite dev`.
const noWorker = base.extend({
	page: async ({browser}, use) => {
		const context = await browser.newContext({
			storageState: {cookies: [], origins: []},
			serviceWorkers: 'block',
		});
		const page = await context.newPage();
		await use(page);
		await context.close();
	},
});
noWorker.use({walletAccountIndex: 6});

describe('Demo Page - notifications with no service worker', () => {
	noWorker.skip(!PUSH_SERVER, 'the run did not start the notifier');

	noWorker(
		'a signed-in account is told the worker is missing, not to sign in',
		async ({connectedPage}) => {
			const page = connectedPage;
			const toggle = page.getByTestId('notify-me');
			await expect(toggle).toHaveAttribute('data-status', 'no-worker', {
				timeout: 30_000,
			});
			// a build: the registration failed, rather than off in development
			await expect(toggle).toHaveAttribute('data-worker', 'unavailable');
			await expect(toggle).not.toContainText('Sign in');
			await expect(page.getByTestId('notify-me-sign-in')).toHaveCount(0);
		},
	);
});

/**
 * QA F21: one browser, two accounts of the app. This device (a subscription
 * that already exists when the page loads, as in a browser that subscribed
 * before) is registered at the push server for ANOTHER account, by a request
 * the test signs itself, before the page checks; the line then says the device
 * is notified for that account and switches it to the signed-in one, which
 * leaves the other account with no device (the app registers with
 * `replaceOtherAccounts`).
 */
const OTHER_ENDPOINT = `https://push.invalid/e2e-other-${Date.now()}`;
const otherAccount = privateKeyToAccount(generatePrivateKey());

async function registerForOtherAccount(appOrigin: string) {
	const delegatePrivateKey = generatePrivateKey();
	const ownershipSignature = await otherAccount.signMessage({
		message: originPublicKeyPublicationMessage(
			appOrigin,
			delegatePublicKey(delegatePrivateKey),
		),
	});
	const url = new URL(`${PUSH_SERVER}/api/register`);
	const body = JSON.stringify({
		address: otherAccount.address,
		domain: appOrigin,
		subscription: {
			endpoint: OTHER_ENDPOINT,
			expirationTime: null,
			keys: {p256dh: 'e2e-p256dh', auth: 'e2e-auth'},
		},
		ownershipSignature,
	});
	const signature = await signRequest(
		{serverOrigin: url.origin, method: 'POST', path: url.pathname, body},
		delegatePrivateKey,
	);
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			[REQUEST_SIGNATURE_HEADER]: signature,
		},
		body,
	});
	expect(response.status, await response.clone().text()).toBe(200);
}

async function devicesOf(address: string, appOrigin: string) {
	const response = await fetch(
		`${PUSH_SERVER}/api/registered/${address}/${encodeURIComponent(appOrigin)}`,
		{headers: {authorization: `Bearer ${PUSH_TOKEN}`}},
	);
	return ((await response.json()) as {count: number}).count;
}

const testOtherAccount = base.extend({
	page: async ({page, baseURL}, use) => {
		const appOrigin = new URL(baseURL!).origin;
		if (PUSH_SERVER) await registerForOtherAccount(appOrigin);
		await page.context().grantPermissions(['notifications']);
		await page.addInitScript((endpoint) => {
			const N = (globalThis as any).Notification;
			if (N) {
				Object.defineProperty(N, 'permission', {get: () => 'granted'});
				N.requestPermission = async () => 'granted';
			}
			const json = {
				endpoint,
				expirationTime: null,
				keys: {p256dh: 'e2e-p256dh', auth: 'e2e-auth'},
			};
			// subscribed already: this browser enabled notifications before
			const subscription = {...json, toJSON: () => json};
			const proto = (globalThis as any).PushManager?.prototype;
			if (!proto) return;
			proto.getSubscription = async () => subscription;
			proto.subscribe = async () => subscription;
		}, OTHER_ENDPOINT);
		await use(page);
	},
});

describe('Demo Page - a device notified for another account', () => {
	testOtherAccount.skip(!PUSH_SERVER, 'the run did not start the notifier');
	testOtherAccount.use({walletAccountIndex: 6});

	testOtherAccount(
		'says so, and switches the device to the signed-in account',
		async ({connectedPage, baseURL}) => {
			const page = connectedPage;
			const appOrigin = new URL(baseURL!).origin;
			const toggle = page.getByTestId('notify-me');
			await expect(toggle).toHaveAttribute('data-status', 'unregistered', {
				timeout: 30_000,
			});
			await expect(toggle).toHaveAttribute(
				'data-other-accounts',
				otherAccount.address.toLowerCase(),
			);
			await expect(page.getByTestId('notify-me-other-account')).toContainText(
				'This device is notified for another account',
			);
			// one account per device: no "notify this one too", and a warning
			await expect(page.getByTestId('notify-me-on')).toHaveCount(0);
			await expect(page.getByTestId('notify-me-switch-warning')).toContainText(
				"Switching stops that account's notifications on this device",
			);

			await page.getByTestId('notify-me-switch').click();
			await expect(toggle).toHaveAttribute('data-status', 'on', {
				timeout: 30_000,
			});
			await expect(toggle).toHaveAttribute('data-trigger', 'on', {
				timeout: 30_000,
			});
			await expect(toggle).not.toHaveAttribute('data-other-accounts');
			await expect(page.getByTestId('notify-me-switch-warning')).toHaveCount(0);
			expect(await devicesOf(otherAccount.address, appOrigin)).toBe(0);

			const subscriber = await page.evaluate(() => {
				let value: string | undefined;
				(globalThis as any).context.account.subscribe(
					(v: string | undefined) => (value = v),
				)();
				return value;
			});
			expect(await devicesOf(subscriber!, appOrigin)).toBe(1);

			// QA F22: a push still on its way for the other account says so
			const cdp = await page.context().newCDPSession(page);
			const registrations: {
				registrationId: string;
				scopeURL: string;
				isDeleted: boolean;
			}[] = [];
			cdp.on('ServiceWorker.workerRegistrationUpdated', (event) =>
				registrations.push(...event.registrations),
			);
			await cdp.send('ServiceWorker.enable');
			await expect
				.poll(() =>
					registrations.some(
						(r) => !r.isDeleted && r.scopeURL.startsWith(appOrigin),
					),
				)
				.toBe(true);
			const registration = registrations.find(
				(r) => !r.isDeleted && r.scopeURL.startsWith(appOrigin),
			)!;
			const greeting = `For Bob ${Date.now()}`;
			await cdp.send('ServiceWorker.deliverPushMessage', {
				origin: appOrigin,
				registrationId: registration.registrationId,
				data: JSON.stringify({
					web_push: 8030,
					notification: {
						title: 'New greeting',
						body: greeting,
						navigate: 'demo',
						data: {account: otherAccount.address.toLowerCase()},
					},
				}),
			});
			const shown = page.locator('[aria-live="assertive"]');
			const short = `${otherAccount.address.toLowerCase().slice(0, 6)}...${otherAccount.address.toLowerCase().slice(-4)}`;
			await expect(
				shown.getByText(`For another account (${short}): ${greeting}`),
			).toBeVisible({timeout: 15_000});
		},
	);
});
