import {describe, it, expect} from 'vitest';
import {writable, type Writable} from 'svelte/store';
import {
	collectRecordedNonces,
	createRecordedNonceReader,
} from '../../../src/lib/account/recorded-nonces';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';

/**
 * WHOSE nonce is it: an operation list holds every sender's work, so a nonce in
 * it is evidence about ONE of them and not about all of them.
 *
 * The two ways of getting this wrong are not symmetric. A false NO over-warns,
 * which is noisy but honest. A false YES makes `reconcileRequest` return
 * `recorded`, and the ledger then DELETES the record as settled, so the warning
 * that should have been shown never is.
 *
 * Runs in the browser project (hence `.svelte.test.ts`) because the reader
 * reads real localStorage.
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
	});

	it('still cannot answer for a sender who owns no list', async () => {
		// THE OTHER HALF, AND IT IS NOT FIXED HERE. The signer's transaction is
		// filed under the PLAYER, but the reader still looks a sender up as though
		// they owned a list, so it reads a scope that is never written and reports
		// NOT KNOWN about something sitting in the user's list. Pinned as it stands
		// rather than left unsaid, so the next commit changes a documented answer
		// instead of an accident.
		localStorage.clear();
		const {read} = reader({
			account: PLAYER,
			live: operations(operation(SIGNER, 4)),
		});
		expect(await read(SIGNER)).toBeUndefined();
	});
});
