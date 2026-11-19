// What the notifications store is fed from in this app: the connection's
// account, the configuration from the environment, the worker's registration.
import {describe, expect, it} from 'vitest';
import {get, writable} from 'svelte/store';
import {hexToString, verifyMessage} from 'viem';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {
	notificationsConfig,
	notifiedAccount,
	serviceWorkerReady,
	walletOwnershipSigner,
	type ConnectionLike,
} from '$lib/push/sources.js';

const signedIn = (address: string, key: string, saved?: string) =>
	({
		step: 'SignedIn',
		account: {
			address,
			signer: {privateKey: key},
			...(saved ? {savedPublicKeyPublicationSignature: saved} : {}),
		},
	}) as unknown as ConnectionLike;

describe('notifiedAccount', () => {
	it('is undefined until the account is signed in', () => {
		const connection = writable<ConnectionLike>({
			step: 'Idle',
		} as ConnectionLike);
		expect(get(notifiedAccount(connection))).toBeUndefined();
	});

	it("is the wallet, the app's delegate key and connect's saved signature", () => {
		const connection = writable(signedIn('0xA', '0x1', '0xsig'));
		expect(get(notifiedAccount(connection))).toEqual({
			address: '0xA',
			delegatePrivateKey: '0x1',
			ownershipSignature: '0xsig',
		});
	});

	it('keeps its identity while the account does not change, so nothing re-checks', () => {
		const connection = writable(signedIn('0xA', '0x1'));
		const account = notifiedAccount(connection);
		const seen: unknown[] = [];
		const stop = account.subscribe((value) => seen.push(value));
		connection.set(signedIn('0xA', '0x1'));
		connection.set(signedIn('0xB', '0x2'));
		stop();
		// a store of an object re-emits it; what downstream compares is its identity
		expect(seen[1]).toBe(seen[0]);
		expect(seen[2]).not.toBe(seen[0]);
		expect(seen[2]).toMatchObject({address: '0xB'});
	});
});

describe('notificationsConfig', () => {
	const env = {
		PUBLIC_PUSH_SERVER: 'http://localhost:34005/api',
		PUBLIC_VAPID_PUBLIC_KEY: 'BKey',
		PUBLIC_NOTIFIER: 'http://localhost:34006',
	};

	it('is the three services and the page origin', () => {
		expect(notificationsConfig(env, 'http://localhost:5173')).toEqual({
			pushServer: 'http://localhost:34005/api',
			vapidPublicKey: 'BKey',
			notifier: 'http://localhost:34006',
			domain: 'http://localhost:5173',
		});
	});

	it('is undefined when any of them is empty, on the browser or off it', () => {
		for (const name of Object.keys(env)) {
			expect(
				notificationsConfig({...env, [name]: ''}, 'http://x'),
			).toBeUndefined();
			expect(
				notificationsConfig({...env, [name]: ''}, undefined),
			).toBeUndefined();
		}
	});

	it("is 'off-browser' when they are set but there is no page yet", () => {
		expect(notificationsConfig(env, undefined)).toBe('off-browser');
	});

	it('drops a trailing slash, so the paths it signs are the ones the services see', () => {
		expect(
			notificationsConfig(
				{
					...env,
					PUBLIC_PUSH_SERVER: 'http://p/api/',
					PUBLIC_NOTIFIER: 'http://n/',
				},
				'http://x',
			),
		).toMatchObject({pushServer: 'http://p/api', notifier: 'http://n'});
	});
});

describe('serviceWorkerReady', () => {
	it('is undefined where there is no service worker', () => {
		expect(get(serviceWorkerReady(undefined))).toBeUndefined();
	});

	it('is the registration once the worker is ready', async () => {
		const registration = {scope: '/'} as ServiceWorkerRegistration;
		const ready = serviceWorkerReady({ready: Promise.resolve(registration)});
		const values: unknown[] = [];
		const stop = ready.subscribe((value) => values.push(value));
		await Promise.resolve();
		await Promise.resolve();
		stop();
		expect(values).toEqual([undefined, registration]);
	});
});

describe('walletOwnershipSigner', () => {
	it("asks the wallet for personal_sign of the message, the account's own signature", async () => {
		const wallet = privateKeyToAccount(generatePrivateKey());
		const asked: unknown[] = [];
		const provider = {
			request: async ({
				method,
				params,
			}: {
				method: string;
				params?: unknown[];
			}) => {
				asked.push(method);
				const [data] = params as [`0x${string}`, string];
				return wallet.signMessage({message: hexToString(data)});
			},
		};
		const signature = await walletOwnershipSigner(provider)(
			wallet.address,
			'the message',
		);
		expect(asked).toEqual(['personal_sign']);
		expect(
			await verifyMessage({
				address: wallet.address,
				message: 'the message',
				signature,
			}),
		).toBe(true);
	});
});
