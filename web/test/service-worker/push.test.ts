// The service worker's two push handlers, as functions: what a push's text
// becomes (the notification shown, or posted to a focused page), and where a
// click on it navigates. The worker itself (src/service-worker/index.ts) only
// calls these and the browser APIs around them.
import {describe, expect, it} from 'vitest';
import {
	askClient,
	clientForNotification,
	notificationFromPush,
	notificationTarget,
	samePage,
	type DeclarativePushNotification,
	type NotificationClickMessage,
} from '../../src/service-worker/push';

const ICON = '/app/pwa/favicon-512.png';

describe('notificationFromPush', () => {
	it('shows a default notification when the push carries no data', () => {
		expect(notificationFromPush(undefined, ICON)).toEqual({
			title: 'Notification',
			options: {
				body: 'You have a new notification',
				icon: ICON,
				badge: ICON,
			},
		});
	});

	it('shows the text itself when it is not JSON', () => {
		const shown = notificationFromPush('hello there', ICON);
		expect(shown.title).toBe('Notification');
		expect(shown.options.body).toBe('hello there');
	});

	it('reads a declarative push (web_push 8030), keeping where it navigates', () => {
		const push: DeclarativePushNotification = {
			web_push: 8030,
			notification: {
				title: 'New greeting',
				body: 'gm',
				navigate: '/demo',
				tag: 'new-greeting',
			},
		};
		const shown = notificationFromPush(JSON.stringify(push), ICON);
		expect(shown.title).toBe('New greeting');
		expect(shown.options.body).toBe('gm');
		expect(shown.options.tag).toBe('new-greeting');
		expect(shown.options.data).toEqual({navigate: '/demo'});
	});

	it('falls back to the default icon and badge when the push names none, the icon to its image first', () => {
		const push = (notification: object) =>
			JSON.stringify({
				web_push: 8030,
				notification: {title: 't', navigate: '/', ...notification},
			});
		expect(notificationFromPush(push({}), ICON).options.icon).toBe(ICON);
		expect(notificationFromPush(push({}), ICON).options.badge).toBe(ICON);
		expect(
			notificationFromPush(push({image: '/i.png'}), ICON).options.icon,
		).toBe('/i.png');
		expect(
			notificationFromPush(push({icon: '/own.png'}), ICON).options.icon,
		).toBe('/own.png');
	});

	it('keeps the data a push carries, adding navigate only when it has none', () => {
		const push = (data: object) =>
			JSON.stringify({
				web_push: 8030,
				notification: {title: 't', navigate: '/to', data},
			});
		expect(notificationFromPush(push({id: 1}), ICON).options.data).toEqual({
			id: 1,
			navigate: '/to',
		});
		expect(
			notificationFromPush(push({navigate: '/own'}), ICON).options.data,
		).toEqual({navigate: '/own'});
	});

	it('reads the legacy shape, a title with options at the root', () => {
		const shown = notificationFromPush(
			JSON.stringify({title: 'Old', options: {body: 'b'}}),
			ICON,
		);
		expect(shown.title).toBe('Old');
		expect(shown.options.body).toBe('b');
	});
});

describe('notificationTarget', () => {
	const folder = '/ipfs/Qm/';

	it('is undefined when the notification names nowhere', () => {
		expect(notificationTarget(undefined, folder)).toBeUndefined();
		expect(notificationTarget({}, folder)).toBeUndefined();
	});

	it("resolves a relative path against the worker's folder, so a base path is kept", () => {
		expect(notificationTarget({navigate: 'demo'}, folder)).toBe(
			'/ipfs/Qm/demo',
		);
	});

	it('keeps an absolute path and a full URL as they are', () => {
		expect(notificationTarget({navigate: '/demo'}, folder)).toBe('/demo');
		expect(notificationTarget({navigate: 'https://x.example/a'}, folder)).toBe(
			'https://x.example/a',
		);
	});
});

// QA F19: a click goes to an open tab without reloading it.
describe('samePage', () => {
	it('ignores a trailing slash and the hash, not the query or the origin', () => {
		expect(samePage('https://a.example/demo/', 'https://a.example/demo')).toBe(
			true,
		);
		expect(samePage('https://a.example/demo#x', 'https://a.example/demo')).toBe(
			true,
		);
		expect(
			samePage('https://a.example/demo?x=1', 'https://a.example/demo'),
		).toBe(false);
		expect(samePage('https://b.example/demo', 'https://a.example/demo')).toBe(
			false,
		);
		expect(samePage('not a url', 'https://a.example/')).toBe(false);
	});
});

describe('clientForNotification', () => {
	const tab = (url: string, focused = false, visible = false) => ({
		url,
		focused,
		visibilityState: visible ? 'visible' : 'hidden',
	});

	it('is undefined when no tab is open', () => {
		expect(clientForNotification([], 'https://a.example/')).toBeUndefined();
	});

	it('prefers a tab already on the target, even when another is focused', () => {
		const onTarget = tab('https://a.example/demo/');
		const focused = tab('https://a.example/', true, true);
		expect(
			clientForNotification([focused, onTarget], 'https://a.example/demo'),
		).toBe(onTarget);
	});

	it('among tabs on the target, the focused one, then a visible one', () => {
		const hidden = tab('https://a.example/demo/');
		const visible = tab('https://a.example/demo/', false, true);
		const focused = tab('https://a.example/demo/', true, true);
		const target = 'https://a.example/demo/';
		expect(clientForNotification([hidden, visible], target)).toBe(visible);
		expect(clientForNotification([hidden, visible, focused], target)).toBe(
			focused,
		);
	});

	it('with none on the target (or no target), the focused, else a visible, else the first tab', () => {
		const first = tab('https://a.example/a');
		const visible = tab('https://a.example/b', false, true);
		const focused = tab('https://a.example/c', true, true);
		expect(clientForNotification([first, visible], 'https://a.example/x')).toBe(
			visible,
		);
		expect(clientForNotification([first, visible, focused], undefined)).toBe(
			focused,
		);
		expect(clientForNotification([first], undefined)).toBe(first);
	});
});

describe('askClient', () => {
	const message: NotificationClickMessage = {
		type: 'notification-click',
		url: 'https://a.example/demo',
		data: {id: 1},
	};

	it('is true once the tab answers on the port it was given', async () => {
		let received: unknown;
		const client = {
			postMessage(posted: unknown, transfer: Transferable[]) {
				received = posted;
				(transfer[0] as MessagePort).postMessage({
					type: 'notification-click-ack',
				});
			},
		};
		await expect(askClient(client, message, 1000)).resolves.toBe(true);
		expect(received).toEqual(message);
	});

	it('is false when the tab does not answer in time (a page of an older build)', async () => {
		const client = {postMessage() {}};
		await expect(askClient(client, message, 20)).resolves.toBe(false);
	});

	it('is false when the tab answers something else, or cannot be posted to', async () => {
		const other = {
			postMessage(_: unknown, transfer: Transferable[]) {
				(transfer[0] as MessagePort).postMessage({type: 'pong'});
			},
		};
		await expect(askClient(other, message, 20)).resolves.toBe(false);
		const gone = {
			postMessage() {
				throw new Error('gone');
			},
		};
		await expect(askClient(gone, message, 1000)).resolves.toBe(false);
	});
});
