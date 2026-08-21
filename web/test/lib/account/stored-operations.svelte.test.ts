import {describe, it, expect, vi} from 'vitest';
import {readable} from 'svelte/store';
import {
	createAccountData,
	readStoredOperations,
	type TransactionMetadata,
} from '../../../src/lib/account/AccountData';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';

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
			expect(
				Object.values(stored).map(
					(op) => op.transactionIntent.transactions[0]?.nonce,
				),
			).toEqual([7]);
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
		$version: 1,
		data: {
			operations: {
				'1': {
					transactionIntent: {transactions: [{nonce: 3, hash: '0xa'}]},
					metadata: {type: 'unknown', name: 'x'},
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
