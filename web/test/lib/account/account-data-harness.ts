import {writable} from 'svelte/store';
import type {AsyncStorage} from 'synqable';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';
import type {TransactionMetadata} from '../../../src/lib/account/AccountData';

/**
 * What the account-data tests share: an account store they can switch, and a
 * storage adapter whose loads and saves they control, so "loading", "failed to
 * load" and "failed to save" are states a test can hold the store in rather
 * than race against.
 */

export const ALICE = '0x00000000000000000000000000000000000a11ce' as const;
export const BOB = '0x0000000000000000000000000000000000000b0b' as const;
export const SCOPE = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0' as const;

export const deployments = {
	chain: {id: 31337, genesisHash: '0xgenesis'},
} as unknown as TypedDeployments;

export const clock = {now: () => 1000} as never;

export function accountStore(initial: `0x${string}` | undefined) {
	return writable<`0x${string}` | undefined>(initial);
}

type Deferred = {promise: Promise<void>; resolve: () => void};
function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return {promise, resolve};
}

/**
 * An in-memory storage shared by every account (keyed like the real one), with
 * switches a test flips: hold loads until released, fail loads, fail saves.
 */
export function controlledStorage() {
	const saved = new Map<string, unknown>();
	let held: Deferred | undefined;
	let heldSaves: Deferred | undefined;
	const control = {
		saved,
		saves: 0,
		loadError: undefined as Error | undefined,
		saveError: undefined as Error | undefined,
		/** Loads wait until {@link release} is called. */
		hold() {
			held = deferred();
		},
		release() {
			const gate = held;
			held = undefined;
			gate?.resolve();
		},
		/** Saves already started wait until {@link releaseSaves} is called. */
		holdSaves() {
			heldSaves = deferred();
		},
		releaseSaves() {
			const gate = heldSaves;
			heldSaves = undefined;
			gate?.resolve();
		},
		adapter: (): AsyncStorage<never> => ({
			async load(key) {
				if (held) await held.promise;
				if (control.loadError) throw control.loadError;
				return structuredClone(saved.get(key)) as never;
			},
			async save(key, data) {
				control.saves++;
				// Whether this save fails is decided when it STARTS, so a test can
				// let one save succeed and fail the next one queued behind it.
				const failure = control.saveError;
				const snapshot = structuredClone(data);
				if (heldSaves) await heldSaves.promise;
				// Settle on a later task, as real storage does, so a caller that
				// does not wait for the save would see it unfinished.
				await new Promise((r) => setTimeout(r, 0));
				if (failure) throw failure;
				saved.set(key, snapshot);
			},
			async remove(key) {
				saved.delete(key);
			},
			async exists(key) {
				return saved.has(key);
			},
		}),
	};
	return control;
}

/** The storage key `createAccountData` uses, for seeding and inspecting. */
export function storageKey(account: `0x${string}`) {
	return `__private__31337_0xgenesis_${SCOPE}_${account}`;
}

export function trackedTransaction(from: `0x${string}`, nonce: number) {
	return {
		hash: `0x${nonce.toString(16).padStart(64, '0')}` as `0x${string}`,
		from,
		nonce,
		broadcastTimestampMs: 1000,
		metadata: {
			type: 'functionCall',
			functionName: 'setMessage',
			args: [],
		} as unknown as TransactionMetadata,
	} as never;
}
