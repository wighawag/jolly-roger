import {describe, it, expect} from 'vitest';
import {writable, type Writable} from 'svelte/store';
import {
	collectRecordedNonces,
	createRecordedNonceReader,
} from '../../../src/lib/account/recorded-nonces';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';

/**
 * "Has this app already recorded a transaction from sender S at nonce N?"
 *
 * The answer decides whether a user is told a transaction of theirs may have
 * been lost, so both ways of getting it wrong are expensive and they are not
 * symmetric. A false NO over-warns, which is noisy but honest. A false YES makes
 * `reconcileRequest` return `recorded`, and the ledger then DELETES the record
 * as settled, so the warning that should have been shown never is.
 *
 * Runs in the browser project (hence `.svelte.test.ts`) because the reader
 * searches real localStorage, which is half of what is under test.
 */

const PLAYER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const SIGNER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as const;
const PAYER = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as const;
const SCOPE = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0' as const;

const deployments = {
	chain: {id: 31337, genesisHash: '0xgenesis'},
} as unknown as TypedDeployments;

/** One operation, as `addOperationFromTrackedTransaction` files it. */
function operation(from: string | undefined, nonce: number | undefined) {
	return {
		transactionIntent: {
			transactions: [
				{
					hash: `0x${String(nonce).padStart(64, '0')}`,
					...(from === undefined ? {} : {from}),
					...(nonce === undefined ? {} : {nonce}),
					broadcastTimestampMs: 1000,
				},
			],
		},
		metadata: {type: 'unknown', name: 'x'},
	} as unknown as OnchainOperation;
}

const operations = (
	...entries: OnchainOperation[]
): Record<string, OnchainOperation> =>
	Object.fromEntries(entries.map((op, i) => [String(i), op]));

/** Put a list in storage under one account's scope, as the store would. */
function store(account: string, ops: Record<string, OnchainOperation>) {
	localStorage.setItem(
		`__private__31337_0xgenesis_${SCOPE}_${account}`,
		JSON.stringify({$version: 1, data: {operations: ops}}),
	);
}

function reader(params: {
	account: `0x${string}` | undefined;
	live?: Record<string, OnchainOperation>;
	ready?: boolean;
	timeoutMs?: number;
}) {
	const live: Writable<Record<string, OnchainOperation>> = writable(
		params.live ?? {},
	);
	let ready = params.ready ?? true;
	const accountData = {
		watchField: () => live,
		isReady: () => ready,
	} as never;
	return {
		live,
		setReady: (value: boolean) => {
			ready = value;
			live.update((v) => v);
		},
		read: createRecordedNonceReader({
			accountData,
			account: writable(params.account) as never,
			deployments,
			scopeAddress: SCOPE,
			timeoutMs: params.timeoutMs ?? 10_000,
		}),
	};
}

describe('collectRecordedNonces', () => {
	it('returns only the nonces this sender used', () => {
		const ops = operations(operation(PLAYER, 4), operation(SIGNER, 9));
		expect(collectRecordedNonces(ops, PLAYER)).toEqual([4]);
		expect(collectRecordedNonces(ops, SIGNER)).toEqual([9]);
	});

	it('matches whatever spelling each side used', () => {
		const ops = operations(operation(PLAYER.toUpperCase(), 4));
		expect(collectRecordedNonces(ops, PLAYER)).toEqual([4]);
	});

	it('attributes an attempt with no sender to nobody', () => {
		// Strict: an attempt that does not say who sent it is not evidence about
		// this sender, and guessing would be a false YES, the dangerous direction.
		const ops = operations(operation(undefined, 4));
		expect(collectRecordedNonces(ops, PLAYER)).toEqual([]);
	});
});

describe('createRecordedNonceReader: whose nonce is it', () => {
	it('does not lend one sender its neighbour a nonce', async () => {
		// THE FALSE YES. One player's list holds every sender's work, so pooling
		// the nonces let the signer's 4 answer a question about the account's 4.
		// The account then had an unresolved request silently dropped as settled.
		localStorage.clear();
		const {read} = reader({
			account: PLAYER,
			live: operations(operation(SIGNER, 4)),
		});
		expect(await read(PLAYER)).toEqual([]);
		expect(await read(SIGNER)).toEqual([4]);
	});
});

describe('createRecordedNonceReader: senders who own no list', () => {
	it('finds the signer, whose work is filed under the player', async () => {
		// Pre-existing, and the reason this is not a payment-rail patch. The signer
		// never has account data of its own, so looking it up under its own address
		// read a scope that is never written and answered NOT KNOWN about a
		// transaction sitting in the user's list.
		localStorage.clear();
		const {read} = reader({
			account: PLAYER,
			live: operations(operation(SIGNER, 4)),
		});
		expect(await read(SIGNER)).toEqual([4]);
	});

	it('finds the payer after a reload, with nobody connected', async () => {
		// The payment rail across the window it exists for: the tab died mid
		// purchase, nothing is connected yet, and the record names the PAYER while
		// the operation sits in the PLAYER's stored list.
		localStorage.clear();
		store(PLAYER, operations(operation(PAYER, 9)));
		const {read} = reader({account: undefined});
		expect(await read(PAYER)).toEqual([9]);
	});

	it('searches every stored list, not just the newest', async () => {
		localStorage.clear();
		store(PLAYER, operations(operation(PAYER, 9)));
		store(SIGNER, operations(operation(PAYER, 11)));
		const {read} = reader({account: undefined});
		expect([...(await read(PAYER))!].sort((a, b) => a - b)).toEqual([9, 11]);
	});

	it('counts a nonce once when live and storage both hold it', async () => {
		// Synqable debounces, so the connected player's list is in both sources.
		localStorage.clear();
		store(PLAYER, operations(operation(PAYER, 9)));
		const {read} = reader({
			account: PLAYER,
			live: operations(operation(PAYER, 9)),
		});
		expect(await read(PAYER)).toEqual([9]);
	});
});

describe('createRecordedNonceReader: what NOT KNOWN means', () => {
	it('says NOT KNOWN, never "none", when a stored list will not parse', async () => {
		// What we could not read is exactly where the answer might have been.
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${PLAYER}`,
			JSON.stringify({$version: 2, somethingElse: {}}),
		);
		const {read} = reader({account: undefined});
		expect(await read(PAYER)).toBeUndefined();
	});

	it('answers "none" when storage is readable and simply empty', async () => {
		// Distinct from the above, and it is a real answer: nothing is connected,
		// so there is no live list to be waiting on, and storage is the whole of
		// what the app knows.
		localStorage.clear();
		const {read} = reader({account: undefined});
		expect(await read(PAYER)).toEqual([]);
	});

	it('says NOT KNOWN while a connected list is still restoring', async () => {
		localStorage.clear();
		const {read} = reader({account: PLAYER, ready: false, timeoutMs: 20});
		expect(await read(PLAYER)).toBeUndefined();
	});

	it('answers once the restore finishes rather than giving up early', async () => {
		localStorage.clear();
		const {read, setReady} = reader({
			account: PLAYER,
			live: operations(operation(PLAYER, 4)),
			ready: false,
			timeoutMs: 5000,
		});
		const pending = read(PLAYER);
		setReady(true);
		expect(await pending).toEqual([4]);
	});
});
