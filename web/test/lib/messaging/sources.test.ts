import {describe, expect, it} from 'vitest';
import {get, writable} from 'svelte/store';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {deriveKeySet} from 'delegated-identity';
import {messagingAccount, messagingConfig} from '$lib/messaging/sources.js';
import type {ConnectionLike} from '$lib/push/sources.js';

describe('messagingConfig', () => {
	it('is undefined when PUBLIC_MISSIV is unset: messaging is not configured', () => {
		expect(
			messagingConfig({}, 'http://localhost:5173', 'demo'),
		).toBeUndefined();
		expect(
			messagingConfig({PUBLIC_MISSIV: ''}, 'http://localhost:5173', 'demo'),
		).toBeUndefined();
	});

	it('is off-browser with no page yet', () => {
		expect(
			messagingConfig(
				{PUBLIC_MISSIV: 'http://127.0.0.1:34007'},
				undefined,
				'demo',
			),
		).toBe('off-browser');
	});

	it("names the page's host as missiv's domain and its origin as the app's", () => {
		expect(
			messagingConfig(
				{PUBLIC_MISSIV: 'http://127.0.0.1:34007/'},
				'http://localhost:5173',
				'demo',
			),
		).toEqual({
			endpoint: 'http://127.0.0.1:34007',
			domain: 'localhost:5173',
			appOrigin: 'http://localhost:5173',
			namespace: 'demo',
		});
		expect(
			messagingConfig(
				{PUBLIC_MISSIV: 'https://missiv.example'},
				'https://app.example',
				'x',
			),
		).toMatchObject({
			domain: 'app.example',
			appOrigin: 'https://app.example',
		});
	});
});

describe('messagingAccount', () => {
	const wallet = privateKeyToAccount(generatePrivateKey());
	const privateKey = generatePrivateKey();
	// the key set connect derives from the origin key
	const signedIn = (key = privateKey): ConnectionLike => ({
		step: 'SignedIn',
		account: {
			address: wallet.address, // checksummed, as connect gives it
			signer: {origin: 'http://localhost:5173'},
			keySet: deriveKeySet(key),
		},
	});

	it("is missiv's account: the wallet in lower case hex, and the key set", () => {
		const account = get(messagingAccount(writable(signedIn())));
		expect(account).toEqual({
			address: wallet.address.toLowerCase(),
			keySet: deriveKeySet(privateKey),
		});
	});

	it('is undefined unless signed in', () => {
		expect(
			get(
				messagingAccount(writable<ConnectionLike>({step: 'WalletConnected'})),
			),
		).toBeUndefined();
	});

	it('is one object per account and key set, a new one for another key set', () => {
		const connection = writable(signedIn());
		const account = messagingAccount(connection);
		const seen: unknown[] = [];
		const stop = account.subscribe((value) => seen.push(value));
		connection.set(signedIn());
		expect(seen.at(-1)).toBe(seen[0]);
		const other = generatePrivateKey();
		connection.set(signedIn(other));
		expect(seen.at(-1)).not.toBe(seen[0]);
		stop();
	});
});
