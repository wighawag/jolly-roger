import {describe, it, expect} from 'vitest';
import {
	findWallet,
	isKnownSource,
	walletIdentityOf,
	walletNameToReopen,
	type TxSource,
} from '../../../../src/lib/core/connection/tx-source';

const wallet = (name: string, rdns?: string) => ({info: {name, rdns}});

describe('walletIdentityOf', () => {
	it('reads the wallet the connection agreed to, and enriches it with rdns', () => {
		expect(
			walletIdentityOf({
				mechanism: {type: 'wallet', name: 'Rabby'},
				wallets: [
					wallet('MetaMask', 'io.metamask'),
					wallet('Rabby', 'io.rabby'),
				],
			}),
		).toEqual({name: 'Rabby', rdns: 'io.rabby'});
	});

	it('still reports the name when the wallet announces no rdns', () => {
		expect(
			walletIdentityOf({
				mechanism: {type: 'wallet', name: 'Rabby'},
				wallets: [wallet('Rabby')],
			}),
		).toEqual({name: 'Rabby'});
	});

	it('reports nothing for an account that authenticated without a wallet', () => {
		// Email/social sign-in: there is no wallet, and inventing one would put a
		// "reconnect MetaMask" button in front of a user who has never used one.
		expect(
			walletIdentityOf({mechanism: {type: 'email'}, wallets: []}),
		).toBeUndefined();
	});

	it('reports nothing for a connection holding nobody', () => {
		expect(walletIdentityOf(undefined)).toBeUndefined();
		expect(walletIdentityOf({})).toBeUndefined();
	});
});

describe('findWallet', () => {
	it('prefers rdns, which is what tells two same-named wallets apart', () => {
		const first = wallet('Wallet', 'com.first');
		const second = wallet('Wallet', 'com.second');
		expect(
			findWallet([first, second], {name: 'Wallet', rdns: 'com.second'}),
		).toBe(second);
	});

	it('FALLS BACK TO THE NAME when the recorded rdns matches nothing', () => {
		// THE REGRESSION THIS FILE EXISTS FOR. Some wallets announce an rdns that
		// is scoped to the browser session rather than stable across them, so a
		// perfectly valid record can carry an rdns that will never match again.
		// Treating that as "wallet not installed" tells the user their wallet is
		// gone while it sits in their toolbar, and strands the transaction.
		const rabby = wallet('Rabby', 'io.rabby.session-9f2c');
		expect(
			findWallet([rabby], {name: 'Rabby', rdns: 'io.rabby.session-0001'}),
		).toBe(rabby);
	});

	it('reports absence only when the name matches nothing either', () => {
		expect(
			findWallet([wallet('Rabby', 'io.rabby')], {name: 'Frame'}),
		).toBeUndefined();
	});

	it('has nothing to find without a list or an identity', () => {
		expect(findWallet(undefined, {name: 'Rabby'})).toBeUndefined();
		expect(findWallet([wallet('Rabby')], undefined)).toBeUndefined();
	});
});

describe('walletNameToReopen', () => {
	it('uses the LIVE name, so a wallet that renamed itself is still reachable', () => {
		// Matched by rdns, but connect() takes a name, and the name it will match
		// on is the one being announced now.
		expect(
			walletNameToReopen([wallet('Rabby Wallet', 'io.rabby')], {
				name: 'Rabby',
				rdns: 'io.rabby',
			}),
		).toBe('Rabby Wallet');
	});

	it('falls back to the recorded name when nothing is announced', () => {
		// Better to attempt the connection and let the wallet explain itself than
		// to refuse pre-emptively on the strength of an empty announcement list,
		// which is also what an announcement race looks like.
		expect(walletNameToReopen([], {name: 'Rabby'})).toBe('Rabby');
	});

	it('has no name to offer without an identity', () => {
		expect(walletNameToReopen([wallet('Rabby')], undefined)).toBeUndefined();
	});
});

describe('isKnownSource', () => {
	it('accepts each route', () => {
		const routes: TxSource[] = [
			{route: 'account'},
			{route: 'signer'},
			{route: 'rail'},
		];
		for (const source of routes) expect(isKnownSource(source)).toBe(true);
	});

	it('rejects what a pre-source record actually holds', () => {
		// The type says `source` is always present. Stored operations written by
		// an older build disagree, and they are read back through that type, so
		// this check is the one place allowed to distrust it.
		expect(isKnownSource(undefined)).toBe(false);
		expect(isKnownSource({route: 'gnosis-safe'} as unknown as TxSource)).toBe(
			false,
		);
	});
});
