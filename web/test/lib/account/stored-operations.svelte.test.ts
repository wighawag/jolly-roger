import {describe, it, expect, vi} from 'vitest';
import {readable} from 'svelte/store';
import {
	createAccountData,
	readStoredOperations,
	type TransactionMetadata,
} from '../../../src/lib/account/AccountData';
import {collectRecordedNonces} from '../../../src/lib/account/recorded-nonces';
import {serializer} from '../../../src/lib/core/utils/data/serializer';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';
import v1Record from '../../fixtures/operations-v1-record.json';

/**
 * `readStoredOperations` reads synqable's ON-DISK ENVELOPE directly, without
 * going through the store that wrote it, because the question it answers ("does
 * the app already hold an operation at this nonce?") has to work for an account
 * that is not connected, on a page where no wallet has attached.
 *
 * That envelope is not a public contract, so this test writes through the REAL
 * store and reads back through the real reader. If synqable ever changes shape,
 * this fails loudly here rather than quietly turning "we already have this
 * transaction" into "we never saw it", which is the app inventing evidence.
 *
 * Runs in the browser project (hence `.svelte.test.ts`) because it needs a real
 * localStorage, which is the thing under test.
 */

const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const SCOPE = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0' as const;

const deployments = {
	chain: {id: 31337, genesisHash: '0xgenesis'},
} as unknown as TypedDeployments;

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

describe('readStoredOperations, against what the real store writes', () => {
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
					const stored = readStoredOperations({
						deployments,
						scopeAddress: SCOPE,
						account: ACCOUNT,
					});
					expect(stored).toBeDefined();
					expect(Object.values(stored!)).toHaveLength(1);
				},
				{timeout: 5000},
			);

			const stored = readStoredOperations({
				deployments,
				scopeAddress: SCOPE,
				account: ACCOUNT,
			})!;
			// The nonce is the whole point: it is what reconciliation compares.
			expect(Object.values(stored).map((op) => op.attempts[0]?.nonce)).toEqual([
				7,
			]);
		} finally {
			stop();
		}
	});

	it('says NOT KNOWN, never "none", for an account it has nothing for', () => {
		localStorage.clear();
		expect(
			readStoredOperations({
				deployments,
				scopeAddress: SCOPE,
				account: '0x0000000000000000000000000000000000000001',
			}),
		).toBeUndefined();
	});

	it('says NOT KNOWN when the envelope is not the shape it expects', () => {
		// The drift case. Returning `{}` here would tell reconciliation the app
		// never saw the transaction, which is exactly the lie to avoid.
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
			JSON.stringify({$version: 2, somethingElse: {operations: {}}}),
		);
		expect(
			readStoredOperations({
				deployments,
				scopeAddress: SCOPE,
				account: ACCOUNT,
			}),
		).toBeUndefined();
	});
});

describe('readStoredOperations and address casing', () => {
	// A record can carry a checksummed address while the multi-account store was
	// handed the provider's lowercase one. Looking under only one spelling
	// returns NOT KNOWN for data that is right there, and the user is then told a
	// transaction "may have been sent" while it sits in their list.
	const CHECKSUMMED = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
	const stored = {
		$version: 2,
		data: {
			operations: {
				'1': {
					metadata: {type: 'unknown', name: 'x'},
					// `'0n'` is the ON-DISK form of a bigint (see utils/data/serializer),
					// which is what this writes: the fixture is raw storage, not a value
					// going through the store.
					call: {from: ACCOUNT, to: null, value: '0n', data: '0x'},
					attempts: [{nonce: 3, hash: '0xa', gasParameters: {}}],
				},
			},
		},
	};

	it('finds data written under the lowercase spelling', () => {
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
			JSON.stringify(stored),
		);
		expect(
			readStoredOperations({
				deployments,
				scopeAddress: SCOPE,
				account: CHECKSUMMED,
			}),
		).toBeDefined();
	});

	it('finds data written under the checksummed spelling', () => {
		localStorage.clear();
		localStorage.setItem(
			`__private__31337_0xgenesis_${SCOPE}_${CHECKSUMMED}`,
			JSON.stringify(stored),
		);
		expect(
			readStoredOperations({
				deployments,
				scopeAddress: SCOPE,
				account: CHECKSUMMED,
			}),
		).toBeDefined();
		expect(
			readStoredOperations({
				deployments,
				scopeAddress: SCOPE,
				account: ACCOUNT,
			}),
		).toBeDefined();
	});
});

/**
 * THE MIGRATION, ON BOTH READ PATHS.
 *
 * There are two ways this app gets operations out of localStorage, and they do
 * not share a code path:
 *
 *   1. `createSyncableStore`, which runs `migrations` on load.
 *   2. `readStoredOperations`, which parses the envelope ITSELF, because the
 *      question it answers ("does the app already hold an operation at this
 *      nonce?") has to work for an account nobody is connected as.
 *
 * One upgrade function is used by both. Miss the second and the nonce scan
 * keeps returning pre-migration records, `collectRecordedNonces` reads
 * `attempts` off records that only have `transactionIntent`, finds nothing, and
 * the user is told a transaction may have been sent while it sits in their
 * list. That is precisely the failure `readStoredOperations` was added to fix,
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
		const stored = readStoredOperations({
			deployments,
			scopeAddress: SCOPE,
			account: ACCOUNT,
		})!;

		expect(stored).toBeDefined();
		const op = stored['1739000000000'];
		// The new shape, read straight off disk without the store.
		expect(op.attempts.map((a) => a.hash)).toHaveLength(2);
		expect(op.call.source).toEqual({route: 'account', wallet: {name: 'Rabby'}});
		expect(op).not.toHaveProperty('transactionIntent');
		expect(op.metadata).not.toHaveProperty('tx');

		// And what the caller actually wanted: the nonces. This is the assertion
		// that fails if the second read path is left un-migrated.
		expect(collectRecordedNonces(stored).sort()).toEqual([12, 12, 13]);
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
		const direct = readStoredOperations({
			deployments,
			scopeAddress: SCOPE,
			account: ACCOUNT,
		})!;
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
		const second = readStoredOperations({
			deployments,
			scopeAddress: SCOPE,
			account: ACCOUNT,
		})!;
		expect(Object.keys(second)).toEqual(Object.keys(direct));
		expect(second['1739000000000'].attempts).toHaveLength(2);
	});
});
