// QA F16: the notifier's services log through `named-logs`, which prints
// nothing until a sink is installed, so a push the browser's push service
// refused was a 502 with no reason in the "push server" pane.
import {describe, expect, it, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {
	consoleLogFactory,
	loggerEnabled,
	logLevel,
} from '../../notifier/log-console';

function fakeOut() {
	return {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
	};
}

describe('the notifier log sink', () => {
	it('prints errors and warnings by default, named, and nothing below', () => {
		const out = fakeOut();
		const logger = consoleLogFactory({}, out)('push-server') as any;
		logger.error('refused', 403);
		logger.warn('slow');
		logger.info('hello');
		logger.debug('details');
		expect(out.error).toHaveBeenCalledWith('[push-server]', 'refused', 403);
		expect(out.warn).toHaveBeenCalledWith('[push-server]', 'slow');
		expect(out.info).not.toHaveBeenCalled();
		expect(out.debug).not.toHaveBeenCalled();
	});

	it('shows more with a level, by name or number', () => {
		expect(logLevel(undefined)).toBe(2);
		expect(logLevel('debug')).toBe(5);
		expect(logLevel('3')).toBe(3);
		expect(logLevel('nonsense')).toBe(2);
		const out = fakeOut();
		(consoleLogFactory({level: 'info'}, out)('x') as any).info('on');
		expect(out.info).toHaveBeenCalledWith('[x]', 'on');
	});

	it('narrows by name, with wildcards and exclusions', () => {
		expect(loggerEnabled('push-notification-server-api', undefined)).toBe(true);
		expect(loggerEnabled('missiv:server', 'missiv:*')).toBe(true);
		expect(loggerEnabled('push-notification-server', 'missiv:*')).toBe(false);
		expect(loggerEnabled('missiv:server', '*,-missiv:*')).toBe(false);
	});

	it('asserts only when the condition fails', () => {
		const out = fakeOut();
		const logger = consoleLogFactory({}, out)('x') as any;
		logger.assert(true, 'fine');
		logger.assert(false, 'broken');
		expect(out.error).toHaveBeenCalledTimes(1);
		expect(out.error).toHaveBeenCalledWith('[x] assertion failed', 'broken');
	});

	it("puts push-notification-server's refused push in the pane", async () => {
		const out = fakeOut();
		const globals = globalThis as {_logFactory?: unknown};
		const before = globals._logFactory;
		// installed BEFORE the server's modules load, as serve.js does
		globals._logFactory = consoleLogFactory({}, out);
		try {
			const {createNodeServer} = await import('@push-notification/cli');
			const {createPushNotifications} =
				await import('@push-notification/client');
			const APP = 'https://greetings.example';
			const TOKEN = 'the-token';
			const digest = await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(TOKEN),
			);
			const hash = [...new Uint8Array(digest)]
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
			const server = await createNodeServer({
				db: ':memory:',
				env: {
					VAPID_PUBLIC_KEY: '',
					VAPID_PRIVATE_KEY: '',
					PUSH_TOKENS: `${APP}:${hash}`,
				},
				getPushSender: () => async () => ({
					ok: false,
					status: 403,
					body: 'the VAPID key does not match',
				}),
			});
			const network = ((input: string | URL | Request, init?: RequestInit) =>
				server.request(
					String(input instanceof Request ? input.url : input),
					init,
				)) as typeof fetch;

			// one device registered for a wallet, through the browser's client
			const wallet = privateKeyToAccount(generatePrivateKey());
			const endpoint = 'https://push.invalid/device';
			let subscription: unknown = null;
			const registration = {
				pushManager: {
					getSubscription: async () => subscription,
					subscribe: async () =>
						(subscription = {
							endpoint,
							toJSON: () => ({
								endpoint,
								expirationTime: null,
								keys: {p256dh: 'p256dh', auth: 'auth'},
							}),
						}),
				},
			} as unknown as ServiceWorkerRegistration;
			const device = createPushNotifications({
				serverEndpoint: 'https://push.example/api',
				vapidPublicKey:
					'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
				domain: APP,
				account: writable({
					address: wallet.address,
					delegatePrivateKey: generatePrivateKey(),
				}),
				serviceWorker: writable(registration),
				signOwnership: async (_address, message) =>
					wallet.signMessage({message}),
				fetch: network,
				permission: () => 'granted',
				supported: () => true,
			});
			const stop = device.subscribe(() => {});
			await new Promise((resolve) => setTimeout(resolve, 10));
			await device.enable();
			expect(get(device)).toMatchObject({status: 'on'});
			stop();

			const response = await server.request('https://push.example/api/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					authorization: `Bearer ${TOKEN}`,
				},
				body: JSON.stringify({
					address: wallet.address,
					domain: APP,
					message: {
						web_push: 8030,
						notification: {title: 't', navigate: 'https://greetings.example/'},
					},
				}),
			});
			expect(response.status).toBe(502);
			expect(out.error).toHaveBeenCalledWith(
				'[push-notification-server-api]',
				'Could not push (403): the VAPID key does not match',
			);
		} finally {
			globals._logFactory = before;
		}
	});
});
