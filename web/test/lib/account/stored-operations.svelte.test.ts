import {describe, it, expect, vi} from 'vitest';
import {readable} from 'svelte/store';
import {
	createAccountData,
	readAllStoredOperations,
	type TransactionMetadata,
} from '../../../src/lib/account/AccountData';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';

/**
 * `readAllStoredOperations` reads synqable's ON-DISK ENVELOPE directly, without
 * going through the store that wrote it, because the question it answers ("has
 * the app already recorded a transaction from this sender at this nonce?") has
 * to work when nobody is connected, on a page where no wallet has attached.
 *
 * That envelope is not a public contract, so this test writes through the REAL
 * store and reads back through the real reader. If synqable ever changes shape,
 * this fails loudly here rather than quietly turning "we already have this
 * transaction" into "we never saw it", which is the app inventing evidence.
 *
 * WHY IT READS EVERY LIST RATHER THAN ONE. It used to take an address and look
 * that account up, which was accurate only while one account sent everything. A
 * signer's transactions and a payer's are filed under the PLAYER, so looking
 * them up under their own address read a scope that is never written. Whose list
 * an operation is in carries no information for this question: a nonce belongs
 * to the account that signs, so the caller filters on `from` (see
 * `account/recorded-nonces.ts`, which is where that half is tested).
 *
 * NOTHING HERE TESTS ADDRESS CASING ANY MORE, and that is a deletion rather than
 * an oversight. The old reader built a key containing the account, so it had to
 * try three spellings (as-given, lowercase, checksummed) or answer NOT KNOWN for
 * data that was right there. The scan reads the account OUT of the key instead
 * of building it in, so there is no spelling left to get wrong.
 *
 * Runs in the browser project (hence `.svelte.test.ts`) because it needs a real
 * localStorage, which is the thing under test.
 */

const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const OTHER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as const;
const SCOPE = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0' as const;

const deployments = {
	chain: {id: 31337, genesisHash: '0xgenesis'},
} as unknown as TypedDeployments;

const read = () => readAllStoredOperations({deployments, scopeAddress: SCOPE});

/** Every nonce the reader found, across every list, in any order. */
const noncesFound = () =>
	read()
		.operations.flatMap((ops) => Object.values(ops))
		.flatMap((op) => op.transactionIntent.transactions.map((tx) => tx.nonce))
		.sort((a, b) => (a ?? 0) - (b ?? 0));

function trackedTransaction(nonce: number) {
	return {
		hash: `0x${nonce.toString(16).padStart(64, '0')}` as `0x${string}`,
		from: ACCOUNT,
		nonce,
		broadcastTimestampMs: 1000,
		metadata: {
			type: 'functionCall',
			functionName: 'setMessage',
			args: [],
		} as unknown as TransactionMetadata,
	} as never;
}

const envelope = (nonce: number, from: string = ACCOUNT) => ({
	$version: 1,
	data: {
		operations: {
			'1': {
				transactionIntent: {transactions: [{nonce, from, hash: '0xa'}]},
				metadata: {type: 'unknown', name: 'x'},
			},
		},
	},
});

describe('readAllStoredOperations, against what the real store writes', () => {
	it('reads back an operation the store persisted', async () => {
		localStorage.clear();
		const accountData = createAccountData({
			accountStore: readable<`0x${string}` | undefined>(ACCOUNT),
			deployments,
			clock: {now: () => 1000} as never,
			scopeAddress: SCOPE,
		});
		// Subscribing is what starts the multi-account store.
		const stop = accountData.subscribe(() => {});
		try {
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));

			accountData.addOperationFromTrackedTransaction(trackedTransaction(7));

			// Synqable debounces its saves, so wait for the write rather than assume.
			await vi.waitFor(
				() => {
					// The nonce is the whole point: it is what reconciliation compares.
					expect(noncesFound()).toEqual([7]);
				},
				{timeout: 5000},
			);
			expect(read().complete).toBe(true);
		} finally {
			stop();
		}
	});
});

describe('readAllStoredOperations: what it can and cannot see', () => {
	it('finds every account this browser has a list for', () => {
		// The reason it scans: the sender being asked about is routinely not the
		// owner of the list holding their transaction.
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
			JSON.stringify(envelope(3)),
		);
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${OTHER}`,
			JSON.stringify(envelope(5)),
		);
		expect(noncesFound()).toEqual([3, 5]);
		expect(read().complete).toBe(true);
	});

	it('ignores lists belonging to another chain or deployment', () => {
		// The prefix pins chain, genesis and scope. A record is reconciled by
		// nonce, and a nonce from another chain is not evidence about this one.
		localStorage.clear();
		localStorage.setItem(
			`__private__1_0xgenesis_${SCOPE}_${ACCOUNT}`,
			JSON.stringify(envelope(3)),
		);
		localStorage.setItem(
			`__private__31337_0xother_${SCOPE}_${ACCOUNT}`,
			JSON.stringify(envelope(4)),
		);
		localStorage.setItem(
			`__private__31337_0xgenesis_${OTHER}_${ACCOUNT}`,
			JSON.stringify(envelope(5)),
		);
		expect(noncesFound()).toEqual([]);
		expect(read().complete).toBe(true);
	});

	it('reports "nothing stored" as complete, not as a failure', () => {
		// A real answer: with nobody connected there is no live list to be behind,
		// so an empty storage means the app genuinely recorded nothing.
		localStorage.clear();
		expect(read()).toEqual({operations: [], complete: true});
	});
});

describe('readAllStoredOperations: an envelope it cannot read', () => {
	it('reports incomplete when the shape is not what it expects', () => {
		// The drift case. Reporting `complete` here would let the caller conclude
		// the app never saw the transaction, which is exactly the lie to avoid.
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
			JSON.stringify({$version: 2, somethingElse: {operations: {}}}),
		);
		expect(read()).toEqual({operations: [], complete: false});
	});

	it('reports incomplete when the contents are not JSON at all', () => {
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
			'not json',
		);
		expect(read().complete).toBe(false);
	});

	it('still returns the lists it COULD read beside the one it could not', () => {
		// Partial knowledge is worth carrying: the caller decides what an unread
		// list costs it, and for a list-shaped answer that means NOT KNOWN.
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
			JSON.stringify(envelope(3)),
		);
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${OTHER}`,
			'not json',
		);
		expect(noncesFound()).toEqual([3]);
		expect(read().complete).toBe(false);
	});
});
