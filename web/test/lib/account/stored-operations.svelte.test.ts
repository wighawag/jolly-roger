import {describe, it, expect, vi} from 'vitest';
import {readable} from 'svelte/store';
import {
	createAccountData,
	readAllStoredOperations,
	type TransactionMetadata,
} from '../../../src/lib/account/AccountData';
import {collectRecordedNonces} from '../../../src/lib/account/recorded-nonces';
import {serializer} from '../../../src/lib/core/utils/data/serializer';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';
import v1Record from '../../fixtures/operations-v1-record.json';

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
		.flatMap((op) => op.attempts.map((attempt) => attempt.nonce))
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

/**
 * A stored envelope in the CURRENT shape. Migration from the previous one has
 * its own block at the end of this file; these tests are about which lists the
 * reader can find, so they use what the store writes today.
 *
 * `'0n'` is the on-disk form of a bigint (see utils/data/serializer): this is
 * raw storage, not a value going through the store.
 */
const envelope = (nonce: number, from: string = ACCOUNT) => ({
	$version: 2,
	data: {
		operations: {
			'1': {
				metadata: {type: 'unknown', name: 'x'},
				call: {from, to: null, value: '0n', data: '0x'},
				attempts: [{nonce, hash: '0xa', gasParameters: {}}],
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

/**
 * THE MIGRATION, ON BOTH READ PATHS.
 *
 * There are two ways this app gets operations out of localStorage, and they do
 * not share a code path:
 *
 *   1. `createSyncableStore`, which runs `migrations` on load.
 *   2. `readAllStoredOperations`, which parses the envelope ITSELF, because the
 *      question it answers ("does the app already hold an operation at this
 *      nonce?") has to work for an account nobody is connected as.
 *
 * One upgrade function is used by both. Miss the second and the nonce scan
 * keeps returning pre-migration records, `collectRecordedNonces` reads
 * `attempts` off records that only have `transactionIntent`, finds nothing, and
 * the user is told a transaction may have been sent while it sits in their
 * list. That is precisely the failure `readAllStoredOperations` was added to fix,
 * so it is asserted here in the terms the caller actually uses.
 *
 * The fixture is the same VERBATIM v1 record the migration's own unit test
 * uses: captured out of localStorage by running the previous build.
 */
describe('reading a v1 record on both paths', () => {
	const KEY = `__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`;

	function seedV1() {
		localStorage.clear();
		localStorage.setItem(KEY, JSON.stringify(v1Record));
	}

	it('migrates on the direct localStorage path', () => {
		seedV1();
		// `readAllStoredOperations` here, this variant's reader: it scans every
		// account's list rather than taking one, so the record comes out of the
		// first (and only) list seeded above.
		const found = read();
		expect(found.complete).toBe(true);
		const stored = found.operations[0];

		expect(stored).toBeDefined();
		const op = stored['1739000000000'];
		// The new shape, read straight off disk without the store.
		expect(op.attempts.map((a) => a.hash)).toHaveLength(2);
		expect(op.call.source).toEqual({route: 'account', wallet: {name: 'Rabby'}});
		expect(op).not.toHaveProperty('transactionIntent');
		expect(op.metadata).not.toHaveProperty('tx');

		// And what the caller actually wanted: the nonces. This is the assertion
		// that fails if the second read path is left un-migrated.
		// Filtered by sender, which is this variant's addition: the list is keyed
		// by the authenticated player and holds whatever any of its senders did.
		expect(collectRecordedNonces(stored, ACCOUNT).sort()).toEqual([12, 12, 13]);
	});

	it('migrates on the store path, and rewrites the record', async () => {
		seedV1();
		const accountData = createAccountData({
			accountStore: readable<`0x${string}` | undefined>(ACCOUNT),
			deployments,
			clock: {now: () => 1739000000000} as never,
			scopeAddress: SCOPE,
		});
		const stop = accountData.subscribe(() => {});
		try {
			await vi.waitFor(() => expect(accountData.isReady()).toBe(true));

			const operations = (
				accountData.get()!.get() as never as {
					data: {operations: Record<string, never>};
				}
			).data.operations;

			const op = operations['1739000000000'] as never as {
				attempts: {hash: string; gasParameters: unknown}[];
				call: {source: unknown; value: unknown};
				state: unknown;
			};
			expect(op.attempts).toHaveLength(2);
			expect(op.state).toMatchObject({
				inclusion: 'Included',
				outcome: 'Failure',
				final: true,
				blockTimestamp: 1739000100,
				via: {kind: 'attempt', attemptIndex: 1},
			});
			// Through the store, the serializer has revived the bigints, so this is
			// the shape the app actually computes with (the direct path above sees
			// them revived too, via the same serializer).
			expect(op.attempts[0].gasParameters).toMatchObject({
				maxFeePerGas: 1500000000n,
			});
			expect(op.call.value).toBe(0n);

			// SYNQABLE DOES NOT PERSIST A MIGRATION ON ITS OWN. `load()` only writes
			// back when its cleanup pass changed something, so until the app next
			// mutates this account's data the record on disk stays at v1 and is
			// migrated again on every load. That is harmless because the upgrade is
			// idempotent and both read paths apply it, but it is worth stating: the
			// on-disk version is NOT the signal for whether the migration ran.
			expect(
				(JSON.parse(localStorage.getItem(KEY)!) as {$version: number}).$version,
			).toBe(1);

			// The next write settles it, in the new shape.
			accountData.addOperationFromTrackedTransaction(trackedTransaction(21));
			await vi.waitFor(
				() => {
					const raw = JSON.parse(localStorage.getItem(KEY)!) as {
						$version: number;
					};
					expect(raw.$version).toBe(2);
				},
				{timeout: 5000},
			);
			expect(localStorage.getItem(KEY)).not.toContain('transactionIntent');
		} finally {
			stop();
		}
	});

	it('agrees with itself: both paths produce the same records', () => {
		// One upgrade function, so this must hold. It is asserted because the
		// cheap way to fix a missed path is to write a second converter, and two
		// converters drift.
		seedV1();
		const direct = read().operations[0];
		// The store writes the migrated envelope back; reading it again must be a
		// no-op rather than a second conversion.
		// Through the app's own serializer, because migrated records hold bigints
		// and `JSON.stringify` throws on one.
		localStorage.setItem(
			KEY,
			// `Serializer` allows an async implementation; this one is synchronous
			// (see utils/data/serializer), which is why the store can be read back
			// without awaiting anything.
			serializer.serialize({
				...v1Record,
				$version: 2,
				data: {operations: direct},
			}) as string,
		);
		const second = read().operations[0];
		expect(Object.keys(second)).toEqual(Object.keys(direct));
		expect(second['1739000000000'].attempts).toHaveLength(2);
	});
});
