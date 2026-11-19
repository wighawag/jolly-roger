// What the notifications store is fed from in this app: the connection's
// account, the configuration from the environment, the worker's registration.
import {describe, expect, it} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	notificationsConfig,
	notifiedAccount,
	serviceWorkerReady,
	publicationSigner,
	type ConnectionLike,
} from '$lib/push/sources.js';
import {originPublicKeyPublicationMessage} from 'delegated-identity';

const signedIn = (address: string, key: string, saved?: string) =>
	({
		step: 'SignedIn',
		account: {
			address,
			signer: {
				origin: 'http://app.example',
				publicKey: `pub-${key}`,
				privateKey: key,
			},
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
		// connect keeping the wallet's publication signature mid-enable: the same
		// account, so the push client does not re-check in the middle of an action
		connection.set(signedIn('0xA', '0x1', '0xsig'));
		connection.set(signedIn('0xB', '0x2'));
		stop();
		// a store of an object re-emits it; what downstream compares is its identity
		expect(seen[1]).toBe(seen[0]);
		expect(seen[2]).toBe(seen[0]);
		expect(seen[3]).not.toBe(seen[0]);
		expect(seen[3]).toMatchObject({address: '0xB'});
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

describe('publicationSigner', () => {
	function connectionOf(state: ConnectionLike) {
		const store = writable(state);
		let asked = 0;
		return {
			subscribe: store.subscribe,
			getSignatureForPublicKeyPublication: async () => {
				asked++;
				return '0xsigned' as `0x${string}`;
			},
			asked: () => asked,
		};
	}
	const message = originPublicKeyPublicationMessage(
		'http://app.example',
		'pub-0x1' as `0x${string}`,
	);

	it("is connect's signature for the account signed in and the message it signs", async () => {
		const connection = connectionOf(signedIn('0xA', '0x1'));
		expect(await publicationSigner(connection)('0xa', message)).toBe(
			'0xsigned',
		);
		expect(connection.asked()).toBe(1);
	});

	it("refuses another message: the app domain is not connect's signing origin", async () => {
		const connection = connectionOf(signedIn('0xA', '0x1'));
		const other = originPublicKeyPublicationMessage(
			'http://elsewhere.example',
			'pub-0x1' as `0x${string}`,
		);
		await expect(publicationSigner(connection)('0xA', other)).rejects.toThrow(
			/signing origin/,
		);
		expect(connection.asked()).toBe(0);
	});

	it('refuses an account that is not the one signed in', async () => {
		const connection = connectionOf(signedIn('0xA', '0x1'));
		await expect(publicationSigner(connection)('0xB', message)).rejects.toThrow(
			/not the account signed in/,
		);
		const idle = connectionOf({step: 'Idle'} as ConnectionLike);
		await expect(publicationSigner(idle)('0xA', message)).rejects.toThrow();
		expect(connection.asked() + idle.asked()).toBe(0);
	});
});
