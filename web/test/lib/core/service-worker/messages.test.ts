import {afterEach, describe, expect, it, vi} from 'vitest';
import {get} from 'svelte/store';
import {createServiceWorker} from '../../../../src/lib/core/service-worker';
import {createNotificationsService} from '../../../../src/lib/core/notifications';
import {isCurrentPage} from '../../../../src/lib/core/service-worker/notification-click';

// The page side of a push the worker forwards to a focused page. The worker
// (`src/service-worker/index.ts`, `handlePush`) posts
// `{type: 'notification', notification: {title, options}}`, so the page must
// read the notification from that field, not take the message for it.

type Listener = (event: MessageEvent) => void;

function fakeNavigator() {
	const listeners: Record<string, Listener[]> = {};
	return {
		listeners,
		serviceWorker: {
			controller: null,
			addEventListener(type: string, listener: Listener) {
				(listeners[type] ||= []).push(listener);
			},
			removeEventListener(type: string, listener: Listener) {
				listeners[type] = (listeners[type] || []).filter((l) => l !== listener);
			},
			// never settles: registration itself is not what is tested here
			register: () => new Promise(() => {}),
		},
	};
}

function post(
	navigator: ReturnType<typeof fakeNavigator>,
	data: unknown,
	ports: {postMessage: (message: unknown) => void}[] = [],
) {
	for (const listener of navigator.listeners['message'] || []) {
		listener({data, ports} as unknown as MessageEvent);
	}
}

function setup(href: string, base = '') {
	const navigator = fakeNavigator();
	vi.stubGlobal('navigator', navigator);
	vi.stubGlobal('location', {href});
	const notifications = createNotificationsService();
	const navigateTo = vi.fn();
	const serviceWorker = createServiceWorker(
		{resolvePath: (path) => base + path, navigateTo},
		notifications,
	);
	serviceWorker.register();
	return {navigator, notifications, navigateTo, serviceWorker};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('a notification the worker posts to the page', () => {
	it('is shown with the title, body and icon the worker sent', () => {
		const navigator = fakeNavigator();
		vi.stubGlobal('navigator', navigator);
		vi.stubGlobal('location', {href: 'https://example.com/'});
		const notifications = createNotificationsService();
		const navigateTo = vi.fn();
		const serviceWorker = createServiceWorker(
			{resolvePath: (path) => path, navigateTo},
			notifications,
		);
		serviceWorker.register();

		post(navigator, {
			type: 'notification',
			notification: {
				title: 'A new greeting',
				options: {
					body: 'someone said hello',
					icon: '/icon.png',
					data: {navigate: '/greetings/'},
				},
			},
		});

		const shown = get(notifications);
		expect(shown).toHaveLength(1);
		expect(shown[0].title).toBe('A new greeting');
		expect(shown[0].body).toBe('someone said hello');
		expect(shown[0].icon).toBe('/icon.png');

		notifications.onAction(shown[0].id);
		// absolute, like a click on the system notification: the same path
		expect(navigateTo).toHaveBeenCalledWith('https://example.com/greetings/');
		expect(get(serviceWorker.notificationClicks)).toEqual({
			id: 1,
			url: 'https://example.com/greetings/',
			data: {navigate: '/greetings/'},
		});
		serviceWorker.cleanup();
	});

	it('ignores a message that is not a notification', () => {
		const navigator = fakeNavigator();
		vi.stubGlobal('navigator', navigator);
		vi.stubGlobal('location', {href: 'https://example.com/'});
		const notifications = createNotificationsService();
		const serviceWorker = createServiceWorker(
			{resolvePath: (path) => path, navigateTo: () => {}},
			notifications,
		);
		serviceWorker.register();

		post(navigator, {type: 'pong'});

		expect(get(notifications)).toHaveLength(0);
		serviceWorker.cleanup();
	});
});

// QA F19: a click on a system notification reaches an open tab as a message
// (`src/service-worker/push.ts`, the click contract), and must never reload it.
describe('a click the worker posts to the page', () => {
	const ack = () => {
		const port = {postMessage: vi.fn()};
		return port;
	};

	it('routes in place to where it leads, answers the worker, and publishes the click', () => {
		const {navigator, navigateTo, serviceWorker} = setup(
			'https://example.com/',
		);
		const port = ack();
		post(
			navigator,
			{
				type: 'notification-click',
				url: 'https://example.com/demo',
				data: {navigate: 'demo', missiv: {conversationID: 'c1'}},
			},
			[port],
		);
		expect(navigateTo).toHaveBeenCalledWith('https://example.com/demo');
		expect(port.postMessage).toHaveBeenCalledWith({
			type: 'notification-click-ack',
		});
		expect(get(serviceWorker.notificationClicks)).toEqual({
			id: 1,
			url: 'https://example.com/demo',
			data: {navigate: 'demo', missiv: {conversationID: 'c1'}},
		});
		serviceWorker.cleanup();
	});

	it('does not move a page already on its URL, trailing slash or not, but still answers and publishes', () => {
		const {navigator, navigateTo, serviceWorker} = setup(
			'https://example.com/demo/',
		);
		const port = ack();
		post(
			navigator,
			{type: 'notification-click', url: 'https://example.com/demo'},
			[port],
		);
		expect(navigateTo).not.toHaveBeenCalled();
		expect(port.postMessage).toHaveBeenCalledTimes(1);
		expect(get(serviceWorker.notificationClicks)?.id).toBe(1);
		serviceWorker.cleanup();
	});

	it('only publishes a click that names nowhere, and counts the clicks', () => {
		const {navigator, navigateTo, serviceWorker} = setup(
			'https://example.com/',
		);
		post(navigator, {type: 'notification-click', data: {a: 1}});
		post(navigator, {type: 'notification-click', data: {a: 2}});
		expect(navigateTo).not.toHaveBeenCalled();
		expect(get(serviceWorker.notificationClicks)).toEqual({
			id: 2,
			url: undefined,
			data: {a: 2},
		});
		serviceWorker.cleanup();
	});

	it("resolves an in-page card's relative path against the worker's folder, keeping a base path", () => {
		const {navigator, notifications, navigateTo, serviceWorker} = setup(
			'https://example.com/ipfs/Qm/',
			'/ipfs/Qm',
		);
		post(navigator, {
			type: 'notification',
			notification: {title: 't', options: {data: {navigate: 'demo'}}},
		});
		notifications.onAction(get(notifications)[0].id);
		expect(navigateTo).toHaveBeenCalledWith('https://example.com/ipfs/Qm/demo');
		serviceWorker.cleanup();
	});
});

describe('isCurrentPage', () => {
	it('is the same page with or without a trailing slash, not with another query or hash', () => {
		const here = 'https://example.com/demo/?a=1';
		expect(isCurrentPage('https://example.com/demo?a=1', here)).toBe(true);
		expect(isCurrentPage('/demo/?a=1', here)).toBe(true);
		expect(isCurrentPage('https://example.com/demo/', here)).toBe(false);
		expect(isCurrentPage('https://example.com/demo/?a=1#x', here)).toBe(false);
		expect(isCurrentPage('https://other.example/demo/?a=1', here)).toBe(false);
	});
});
