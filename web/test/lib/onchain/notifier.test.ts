// The greetings' trigger definitions, as the trigger service loads them, and
// the push they render, as push-notification-server's `/push` validates it.
// The whole path (a greeting folded, matched, pushed) runs in the e2e
// (`greeting-notifications.e2e.ts`); the trigger service's own end to end on
// these greetings is etherfold's `packages/triggers/test/greetings.test.ts`.
import {describe, expect, it} from 'vitest';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {createNodeServer} from '@push-notification/cli';
import {
	defineTriggers,
	type DecodedLog,
} from '@etherfold/platform-nodejs-triggers';
import {
	delegatePublicKey,
	originPublicKeyPublicationMessage,
	REQUEST_SIGNATURE_HEADER,
	signRequest,
} from 'delegated-identity';
import {
	greetingNotification,
	greetingTriggers,
	NEW_GREETING,
} from '$lib/onchain/notifier/greetings.js';

const APP = 'https://greetings.example';
const REGISTRY = '0x0000000000000000000000000000000000000001';

function logOf(user: string, message: string): DecodedLog {
	return {
		event: 'greeting',
		args: {user, message},
		chainId: '31337',
		entry: {} as DecodedLog['entry'],
	};
}

describe('the greetings trigger definitions', () => {
	it('load: the trigger service checks them at startup', () => {
		expect(() => defineTriggers(greetingTriggers(REGISTRY))).not.toThrow();
	});

	it('offer one kind, a new greeting from anyone but the subscriber, pushed', () => {
		const kind = greetingTriggers(REGISTRY).subscriptions[NEW_GREETING];
		expect(kind).toMatchObject({
			event: 'greeting',
			notFrom: 'user',
			action: 'push',
		});
	});

	it('render the greeting as a declarative push that opens the demo', () => {
		const kind = greetingTriggers(REGISTRY).subscriptions[NEW_GREETING];
		expect(kind.render(logOf('0xabc', 'gm'))).toEqual({
			message: {
				web_push: 8030,
				notification: {
					title: 'New greeting',
					body: 'gm',
					navigate: 'demo',
					tag: NEW_GREETING,
				},
			},
			topic: NEW_GREETING,
		});
	});

	it('quote a long greeting cut, the push pointing at the page', () => {
		const body = greetingNotification('x'.repeat(500)).notification.body!;
		expect(body.length).toBe(120);
		expect(body.endsWith('…')).toBe(true);
	});

	it("render what push-notification-server's /push accepts and delivers", async () => {
		const sent: unknown[] = [];
		const token = 'notifier-token';
		const hash = [
			...new Uint8Array(
				await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
			),
		]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		const push = await createNodeServer({
			db: ':memory:',
			env: {
				VAPID_PUBLIC_KEY: '',
				VAPID_PRIVATE_KEY: '',
				PUSH_TOKENS: `${APP}:${hash}`,
			},
			getPushSender: () => async (_subscription, payload) => {
				sent.push(JSON.parse(String(payload)));
				return {ok: true, status: 201};
			},
		});

		// a device registered for a wallet, as the app's toggle does
		const wallet = privateKeyToAccount(generatePrivateKey());
		const delegate = generatePrivateKey();
		const body = JSON.stringify({
			address: wallet.address,
			domain: APP,
			subscription: {
				endpoint: 'https://push.invalid/1',
				expirationTime: null,
				keys: {p256dh: 'p256dh', auth: 'auth'},
			},
			ownershipSignature: await wallet.signMessage({
				message: originPublicKeyPublicationMessage(
					APP,
					delegatePublicKey(delegate),
				),
			}),
		});
		const register = await push.request('https://push.example/api/register', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				[REQUEST_SIGNATURE_HEADER]: await signRequest(
					{
						serverOrigin: 'https://push.example',
						method: 'POST',
						path: '/api/register',
						body,
					},
					delegate,
				),
			},
			body,
		});
		expect(register.status).toBe(200);

		// what the trigger service's push action sends for a match
		const kind = greetingTriggers(REGISTRY).subscriptions[NEW_GREETING];
		const rendered = kind.render(logOf('0xabc', 'gm'));
		const response = await push.request('https://push.example/api/push', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({address: wallet.address, domain: APP, ...rendered}),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({delivered: 1});
		expect(sent).toEqual([rendered.message]);
	});
});
