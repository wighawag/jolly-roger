// The service worker's two push handlers, as functions: what a push's text
// becomes (the notification shown, or posted to a focused page), and where a
// click on it navigates. The worker itself (src/service-worker/index.ts) only
// calls these and the browser APIs around them.
import {describe, expect, it} from 'vitest';
import {
	notificationFromPush,
	notificationTarget,
	type DeclarativePushNotification,
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
