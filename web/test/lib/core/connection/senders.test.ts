import {describe, it, expect} from 'vitest';
import {readable} from 'svelte/store';
import {
	selectSender,
	walletOf,
	type Sender,
	type SenderRegistry,
} from '../../../../src/lib/core/connection/senders';
import type {ExecutorState} from '../../../../src/lib/core/connection/executor';

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const SIGNER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;
const PAYER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;

const ready = (address: `0x${string}`): ExecutorState => ({
	status: 'ready',
	address,
	account: address,
	client: {tag: 'client'} as never,
});

function sender(route: Sender['route'], state: ExecutorState): Sender {
	return {
		route,
		executor: readable(state),
		balance: {tag: `balance:${route}`} as never,
	};
}

/** The three-route app: what `with/local-signer` and its descendants compose. */
function registry(states: {
	account?: ExecutorState;
	signer?: ExecutorState;
	payer?: ExecutorState;
}): SenderRegistry {
	return [
		sender('account', states.account ?? {status: 'not-connected'}),
		sender('signer', states.signer ?? {status: 'not-connected'}),
		sender('rail', states.payer ?? {status: 'not-connected'}),
	];
}

describe('selectSender', () => {
	it('picks the route that signed the original', () => {
		expect(
			selectSender(registry({account: ready(ACCOUNT), signer: ready(SIGNER)}), {
				from: SIGNER,
				source: {route: 'signer'},
			}),
		).toMatchObject({status: 'found', sender: {route: 'signer'}});
	});

	it('picks a DORMANT route just the same, because asleep is not absent', () => {
		// THE ORIGINAL BUG, stated as a test. An avatar was bought through the
		// payment rail; the rail is dormant by construction (autoConnect: false),
		// so no executor was ready at that address and the app told the user their
		// own purchase came from a different account, with no way forward.
		//
		// Readiness is deliberately not consulted here: the caller ensures the
		// route can sign, so a sleeping route is the same answer with a wallet
		// prompt in front of it.
		expect(
			selectSender(registry({account: ready(ACCOUNT), signer: ready(SIGNER)}), {
				from: PAYER,
				source: {route: 'rail', wallet: {name: 'Rabby'}},
			}),
		).toMatchObject({status: 'found', sender: {route: 'rail'}});
	});

	it('does not hand back a ready route just because it is ready', () => {
		// The account executor is awake at another address. Using it would
		// broadcast a new transaction at the wrong account's nonce instead of
		// replacing anything.
		const selection = selectSender(registry({account: ready(ACCOUNT)}), {
			from: PAYER,
			source: {route: 'rail'},
		});
		expect(selection).toMatchObject({sender: {route: 'rail'}});
	});

	it('is unavailable for a route this build no longer registers', () => {
		expect(
			selectSender([sender('account', ready(ACCOUNT))], {
				from: PAYER,
				source: {route: 'rail'},
			}),
		).toEqual({status: 'unavailable', address: PAYER});
	});

	describe('records written before sources existed', () => {
		it('uses the only sender there is, so a locked wallet still recovers', () => {
			// One route means no ambiguity, so there is nothing to be cautious
			// about: this is the single-sender app, and requiring an already-ready
			// executor would strand exactly the locked-wallet case that most needs
			// to work.
			expect(
				selectSender([sender('account', {status: 'not-connected'})], {
					from: ACCOUNT,
				}),
			).toMatchObject({status: 'found', sender: {route: 'account'}});
		});

		it('falls back to an awake executor by address when there are several', () => {
			expect(
				selectSender(registry({account: ready(ACCOUNT)}), {from: ACCOUNT}),
			).toMatchObject({status: 'found', sender: {route: 'account'}});
		});

		it('is unavailable when several routes exist and none is awake there', () => {
			// Guessing WHICH wallet to open, with no recorded route to go on, would
			// be guessing at the user's expense.
			expect(
				selectSender(registry({account: ready(ACCOUNT)}), {from: PAYER}),
			).toEqual({status: 'unavailable', address: PAYER});
		});

		it('survives a stored source whose shape it does not recognise', () => {
			expect(
				selectSender(registry({account: ready(ACCOUNT)}), {
					from: ACCOUNT,
					source: {route: 'from-the-future'} as never,
				}),
			).toMatchObject({status: 'found'});
		});
	});

	it('compares addresses case-insensitively on the legacy path', () => {
		// Checksummed in one place, lowercase in another, and a stuck transaction
		// is the worst moment to discover it.
		expect(
			selectSender(
				[
					sender('account', ready(ACCOUNT.toUpperCase() as `0x${string}`)),
					sender('rail', {status: 'not-connected'}),
				],
				{from: ACCOUNT},
			),
		).toMatchObject({status: 'found', sender: {route: 'account'}});
	});
});

describe('walletOf', () => {
	it('reports the wallet for the routes that have one', () => {
		expect(walletOf({route: 'rail', wallet: {name: 'Rabby'}})).toEqual({
			name: 'Rabby',
		});
	});

	it('reports none for the signer, which has no wallet to reopen', () => {
		expect(walletOf({route: 'signer'})).toBeUndefined();
	});

	it('reports none for a record with no source at all', () => {
		expect(walletOf(undefined)).toBeUndefined();
	});
});
