import {afterEach, describe, expect, it, vi} from 'vitest';
import {get} from 'svelte/store';
import {createServiceWorker} from '../../../../src/lib/core/service-worker';
import {createNotificationsService} from '../../../../src/lib/core/notifications';

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

function post(navigator: ReturnType<typeof fakeNavigator>, data: unknown) {
	for (const listener of navigator.listeners['message'] || []) {
		listener({data} as MessageEvent);
	}
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
		expect(navigateTo).toHaveBeenCalledWith('/greetings/');
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
