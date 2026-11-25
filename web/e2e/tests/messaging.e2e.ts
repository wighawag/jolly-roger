import {test, expect, describe} from '../fixtures/test';
import type {BrowserContext, Page} from '@playwright/test';

/**
 * `with/messaging`, end to end, with TWO browsers (two contexts, two accounts,
 * two sockets): a message in the domain's chat room seen by the other; a direct
 * message sent, received as a request, accepted and read; and missiv's push of
 * it recorded for the recipient's device, which turned "notify me" on.
 *
 * missiv runs beside the notifier (scripts/run-e2e-tests.sh, web/notifier/
 * serve.ts), its pushes going to the RECORDING push server, so the push is
 * asserted from `/recorded`. As in greeting-notifications.e2e.ts, the browser's
 * push subscription is stubbed: a headless Chromium has no push service.
 *
 * ITS OWN ACCOUNT INDEX (7). The burner generates its accounts per browser
 * context, so the second browser, connected at the same index, is another
 * account; neither sends a transaction (messaging is off chain).
 *
 * The direct conversation is opened through the panel's store
 * (`messaging.panel.openConversation`), which the demo's "message this
 * account" button calls: the recipient has no greeting on this chain to click.
 */
test.use({walletAccountIndex: 7});

const PUSH_SERVER = process.env.E2E_PUSH_SERVER!;
const MISSIV = process.env.E2E_MISSIV;
const RECIPIENT_ENDPOINT = `https://push.invalid/e2e-messaging-${Date.now()}`;

/** The stubs greeting-notifications.e2e.ts explains: a granted permission, a fixed subscription. */
async function stubPush(context: BrowserContext, endpoint: string) {
	await context.grantPermissions(['notifications']);
	await context.addInitScript((endpoint) => {
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
	}, endpoint);
}

async function accountOf(page: Page): Promise<string> {
	const address = await page.evaluate(() => {
		let value: string | undefined;
		(globalThis as any).context.account.subscribe(
			(v: string | undefined) => (value = v),
		)();
		return value;
	});
	expect(address).toBeTruthy();
	return address!.toLowerCase();
}

/** Open the panel and register with missiv (one wallet signature, on first use). */
async function joinChat(page: Page) {
	await page.getByTestId('messaging-launcher').click();
	const panel = page.getByTestId('messaging-panel');
	await expect(panel).toBeVisible();
	await panel.getByTestId('messaging-tab-room').click();
	const register = panel.getByTestId('messaging-register');
	await expect(register.or(panel.getByTestId('room-composer'))).toBeVisible({
		timeout: 30_000,
	});
	if (await register.isVisible()) await register.click();
	await expect(panel).toHaveAttribute('data-status', 'registered', {
		timeout: 30_000,
	});
	await expect(panel.getByTestId('room-composer')).toBeVisible({
		timeout: 30_000,
	});
	return panel;
}

type Recorded = {endpoint: string; payload: any};
async function recorded(): Promise<Recorded[]> {
	return (await (await fetch(`${PUSH_SERVER}/recorded`)).json()) as Recorded[];
}

describe('Messaging - a chat room and direct messages, two browsers', () => {
	describe.configure({mode: 'serial'});

	test.skip(!MISSIV || !PUSH_SERVER, 'the run did not start missiv');

	test('a room message, a direct message accepted and read, and its push', async ({
		connectedPage,
		browser,
		connectWallet,
	}) => {
		test.setTimeout(240_000);
		const sender = connectedPage;

		// the recipient: a second browser, notified on this device
		const context = await browser.newContext({
			storageState: {cookies: [], origins: []},
		});
		await stubPush(context, RECIPIENT_ENDPOINT);
		const recipient = await context.newPage();
		try {
			await recipient.goto('/demo');
			await expect(
				recipient.getByPlaceholder('Enter your greeting...'),
			).toBeVisible({timeout: 30_000});
			await recipient
				.getByRole('button', {name: /^connect$/i})
				.first()
				.click();
			await connectWallet(recipient, {fund: false});

			const toggle = recipient.getByTestId('notify-me');
			await recipient.getByTestId('notify-me-on').click({timeout: 30_000});
			await expect(toggle).toHaveAttribute('data-status', 'on', {
				timeout: 30_000,
			});

			const senderAddress = await accountOf(sender);
			const recipientAddress = await accountOf(recipient);
			expect(senderAddress).not.toBe(recipientAddress);

			// both join; the recipient's toggle then says direct messages notify too
			const senderPanel = await joinChat(sender);
			const recipientPanel = await joinChat(recipient);
			await recipient.keyboard.press('Escape');
			await expect(
				recipient.getByTestId('notify-me-direct-messages'),
			).toBeVisible({timeout: 30_000});
			await recipient.getByTestId('messaging-launcher').click();

			// a message in the room, seen by the other browser
			const roomMessage = `Room ${Date.now()}`;
			await senderPanel
				.getByTestId('room-composer')
				.getByRole('textbox')
				.fill(roomMessage);
			await senderPanel
				.getByTestId('room-composer')
				.getByRole('button')
				.click();
			await expect(
				recipientPanel
					.getByTestId('room-message')
					.filter({hasText: roomMessage}),
			).toHaveAttribute('data-from', senderAddress, {timeout: 30_000});

			// a direct message to the recipient, encrypted to their verified key
			await sender.evaluate(
				(address) =>
					(globalThis as any).context.messaging.panel.openConversation(address),
				recipientAddress,
			);
			const conversation = senderPanel.getByTestId('messaging-conversation');
			await expect(conversation).toHaveAttribute('data-with', recipientAddress);
			const direct = `Secret ${Date.now()}`;
			await conversation
				.getByTestId('direct-composer')
				.getByRole('textbox')
				.fill(direct, {timeout: 30_000});
			await conversation
				.getByTestId('direct-composer')
				.getByRole('button')
				.click();
			await expect(
				conversation.getByTestId('direct-message').filter({hasText: direct}),
			).toBeVisible({timeout: 30_000});

			// the recipient: a request from the sender, read before it is answered
			await recipientPanel.getByTestId('messaging-tab-direct').click();
			const request = recipientPanel.locator(
				`[data-testid="inbox-item"][data-address="${senderAddress}"]`,
			);
			await expect(request.first()).toHaveAttribute('data-accepted', 'false', {
				timeout: 30_000,
			});
			await request.first().click();
			const received = recipientPanel.getByTestId('messaging-conversation');
			await expect(received).toHaveAttribute('data-accepted', 'false');
			await expect(
				received.getByTestId('direct-message').filter({hasText: direct}),
			).toBeVisible({timeout: 30_000});

			// accepted: a conversation, answerable
			await received.getByTestId('conversation-accept').click();
			await expect(received).toHaveAttribute('data-accepted', 'true', {
				timeout: 30_000,
			});
			await expect(received.getByTestId('direct-composer')).toBeVisible();
			await expect(
				received.getByTestId('direct-message').filter({hasText: direct}),
			).toBeVisible();

			// QA F15: a room message's author opens a direct conversation with
			// them, offered on others' messages only
			await recipientPanel.getByTestId('messaging-tab-room').click();
			await recipientPanel
				.getByTestId('room-message')
				.filter({hasText: roomMessage})
				.getByTestId('room-message-author')
				.click();
			const fromRoom = recipientPanel.getByTestId('messaging-conversation');
			await expect(fromRoom).toHaveAttribute('data-with', senderAddress, {
				timeout: 30_000,
			});
			await expect(
				fromRoom.getByTestId('direct-message').filter({hasText: direct}),
			).toBeVisible({timeout: 30_000});
			await senderPanel.getByTestId('messaging-tab-room').click();
			await expect(
				senderPanel.getByTestId('room-message').filter({hasText: roomMessage}),
			).toBeVisible();
			await expect(
				senderPanel
					.getByTestId('room-message')
					.filter({hasText: roomMessage})
					.getByTestId('room-message-author'),
			).toHaveCount(0);

			// missiv pushed it to the recipient's device, once, with no content
			await expect
				.poll(
					async () =>
						(await recorded()).filter(
							(push) =>
								push.endpoint === RECIPIENT_ENDPOINT &&
								push.payload?.notification?.title === 'New message',
						).length,
					{timeout: 60_000, intervals: [500]},
				)
				.toBe(1);
			const push = (await recorded()).find(
				(entry) =>
					entry.endpoint === RECIPIENT_ENDPOINT &&
					entry.payload?.notification?.title === 'New message',
			)!;
			expect(push.payload.notification.body).toContain(
				senderAddress.slice(0, 6),
			);
			expect(JSON.stringify(push.payload)).not.toContain(direct);

			// QA F19: clicking it opens that conversation in the open tab, without
			// reloading it. A headless Chromium cannot show nor click a system
			// notification, so the worker's real `notificationclick` handler is
			// dispatched there, on the notification this push becomes (its data
			// and navigate, as `notificationFromPush` keeps them).
			await recipient.evaluate(() => {
				(globalThis as any).context.messaging.panel.close();
				(globalThis as any).__notReloaded = true;
			});
			await expect(recipientPanel).toBeHidden();
			const worker =
				context.serviceWorkers()[0] ??
				(await context.waitForEvent('serviceworker'));
			await worker.evaluate((notification: any) => {
				const event = new Event('notificationclick');
				Object.defineProperty(event, 'notification', {
					value: {
						data: {...notification.data, navigate: notification.navigate},
						close() {},
					},
				});
				self.dispatchEvent(event);
			}, push.payload.notification);
			await expect(
				recipientPanel.getByTestId('messaging-conversation'),
			).toBeVisible({timeout: 15_000});
			expect(
				await recipient.evaluate(() => {
					const g = globalThis as any;
					let view: any;
					g.context.messaging.panel.subscribe((s: any) => (view = s.view))();
					return {view, notReloaded: g.__notReloaded === true};
				}),
			).toEqual({
				view: {kind: 'conversation', address: senderAddress},
				notReloaded: true,
			});
		} finally {
			await context.close();
		}
	});
});

// QA F13: with no account the panel said "Sign in to write." with nothing to
// click; it now signs in from there, then offers to join.
describe('Messaging - before an account', () => {
	test.skip(!MISSIV, 'the run did not start missiv');

	test('the panel signs in, then offers to join', async ({
		page,
		connectWallet,
	}) => {
		await page.goto('/demo');
		await expect(page.getByPlaceholder('Enter your greeting...')).toBeVisible({
			timeout: 30_000,
		});
		await page.getByTestId('messaging-launcher').click();
		const panel = page.getByTestId('messaging-panel');
		await expect(panel).toBeVisible();
		await panel.getByTestId('messaging-tab-room').click();
		await panel.getByTestId('messaging-sign-in').click();
		// the connection flow opens OVER the panel, and takes the click
		// (a trial click: actionable, nothing pressed)
		await page
			.getByRole('dialog', {name: /confirm sign in/i})
			.getByRole('button', {name: /^cancel$/i})
			.click({trial: true, timeout: 30_000});
		// the fixture drives the first `[role="dialog"]`, which the panel also is
		await page.evaluate(() =>
			(globalThis as any).context.messaging.panel.close(),
		);
		await connectWallet(page, {fund: false});
		await page.getByTestId('messaging-launcher').click();
		await panel.getByTestId('messaging-tab-room').click();
		await expect(panel.getByTestId('messaging-register')).toBeVisible({
			timeout: 30_000,
		});
	});
});
