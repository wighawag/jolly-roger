import type {OptionalSigner} from '$lib/core/connection/types';
import type {Readable} from 'svelte/store';
import type {PublicClient} from 'viem';
import {
	createPollingStore,
	type PollingStore,
	type PollingValue,
	type PollingStatus,
} from './polling-store';

/**
 * The signer's funding view: unlike `createBalanceStore` (one account), this
 * polls BOTH the signer's and its owner's balance, in one pass.
 *
 * The pair is the point. A signer is a key the app holds on the user's behalf
 * (a session key derived at sign-in), so it starts empty and can only be filled
 * from outside: by a faucet, or by its owner. Showing "your signer is empty"
 * without knowing whether the owner can do anything about it produces a dead
 * end, so the owner's balance is fetched alongside rather than left to a second
 * store and a second, differently-timed poll.
 *
 * Scoped to the signer, not to a role: `balance`/`ownerBalance` in lib/context
 * follow WHO PAYS and WHO IS AUTHENTICATED, which resolve to different
 * addresses per execution mode. This one always follows the signer, including
 * in wallet execution mode where nothing else does.
 *
 * Gated on the `signer` store, so it is inert (no fetch, no timer) whenever
 * there is no signer: before sign-in, and forever in wallet-only deployments.
 */

export type SignerBalanceValue = PollingValue<{signer: bigint; owner: bigint}>;
export type SignerBalanceStatus = PollingStatus;
export type SignerBalanceStore = PollingStore<{signer: bigint; owner: bigint}>;

export function createSignerBalanceStore(
	params: {
		publicClient: PublicClient;
		signer: Readable<OptionalSigner>;
	},
	options?: {
		fetchInterval?: number;
	},
): SignerBalanceStore {
	const {publicClient, signer} = params;

	return createPollingStore(
		async (currentSigner: OptionalSigner) => {
			const [signerBalance, ownerBalance] = await Promise.all([
				publicClient.getBalance({address: currentSigner!.address}),
				publicClient.getBalance({address: currentSigner!.owner}),
			]);
			return {signer: signerBalance, owner: ownerBalance};
		},
		{
			fetchInterval: options?.fetchInterval ?? 5 * 1000,
			source: {
				store: signer,
				key: (s) => s?.address,
			},
		},
	);
}
