import type {TypedDeployments} from '$lib/core/connection/types';
import {
	createPollingStore,
	type PollingStore,
	type PollingValue,
} from '$lib/core/connection/polling-store';
import {derived, type Readable} from 'svelte/store';
import type {PublicClient} from 'viem';

/**
 * Whether this browser's signer may act for the account, read from the chain.
 *
 * The app has to know this BEFORE it lets a send through, or the user gets a
 * bare `NotDelegate` revert for a state the app could have seen coming. So it
 * is treated the way "needs funds" already is: a state the UI reads, explains,
 * and offers the remedy for.
 *
 * Kept live rather than read once, because it changes underneath the app: the
 * registration lands in a transaction the app itself sent, and the
 * authorisation can be withdrawn from the account panel or from another tab.
 *
 * `withdrawn` comes along because it decides which registration routes are
 * still open. It is PER DELEGATE: set only by a successful `revokeDelegate` for
 * the delegate that was current at the time, and cleared only by an
 * owner-sent `registerDelegate`. So once it is up the signature route for
 * THAT delegate is closed, but a different delegate can still be authorised
 * by a fresh signature - which is what lets a user replace one signer with
 * another without sending a transaction themselves.
 */
export type DelegationState = {
	/** The address currently allowed to act for the account; zero when none. */
	delegate: `0x${string}`;
	/** Whether the account has withdrawn its authorisation for this signer. */
	withdrawn: boolean;
};

export type DelegationValue = PollingValue<DelegationState>;
export type DelegationStore = PollingStore<DelegationState>;

export const ZERO_ADDRESS =
	'0x0000000000000000000000000000000000000000' as const;

/**
 * Whether `signer` is the registered delegate of the account this value
 * describes.
 *
 * Unknown reads as NOT registered, deliberately. The consequence of guessing
 * wrong in that direction is a prompt to register that turns out to be
 * unnecessary; guessing the other way sends a transaction that reverts.
 */
export function isRegistered(
	value: DelegationValue,
	signer: `0x${string}` | undefined,
): boolean {
	if (!signer) return false;
	if (value.step !== 'Loaded') return false;
	return value.delegate.toLowerCase() === signer.toLowerCase();
}

/** What the polling engine fetches: the account and its signer as one scope. */
type DelegationScope = {
	owner: `0x${string}`;
	signer: `0x${string}`;
} | undefined;

export function createDelegationState(params: {
	publicClient: PublicClient;
	deployments: TypedDeployments;
	/** The authenticated account. The read is scoped to it, and resets with it. */
	account: Readable<`0x${string}` | undefined>;
	/**
	 * This browser's signer address. The `withdrawn` read is scoped to it,
	 * because withdrawal is per delegate: a withdrawn signer does not block a
	 * different one.
	 */
	signer: Readable<`0x${string}` | undefined>;
	/** Optional gate, for an app that can only reach the chain via the wallet. */
	fetchGate?: Readable<boolean>;
	fetchInterval?: number;
}): DelegationStore {
	const {publicClient, deployments, account, signer, fetchGate} = params;

	// The polling engine takes ONE source, so the account, the signer and the
	// gate are folded into one: a closed gate reads as "no account to look up",
	// which is already the state that stops the fetch and resets the value.
	// The signer is part of the scope because `delegationWithdrawn` is now
	// keyed per delegate - a change in the signer (e.g. after re-derivation)
	// changes the answer.
	const source: Readable<DelegationScope> = fetchGate
		? derived(
				[account, signer, fetchGate],
				([$account, $signer, $open]) =>
					$open && $account && $signer
						? {owner: $account, signer: $signer}
						: undefined,
			)
		: derived([account, signer], ([$account, $signer]) =>
				$account && $signer
					? {owner: $account, signer: $signer}
					: undefined,
			);

	return createPollingStore(
		async (scope: DelegationScope) => {
			// Never reached with an absent scope: the engine treats a falsy source as
			// "nothing to fetch". Narrowed for the type rather than for the case.
			if (!scope) throw new Error('no account to read delegation for');
			const {owner, signer} = scope;
			const registry = deployments.contracts.GreetingsRegistry;
			const [delegate, withdrawn] = await Promise.all([
				publicClient.readContract({
					...registry,
					functionName: 'delegateOf',
					args: [owner],
				}),
				publicClient.readContract({
					...registry,
					functionName: 'delegationWithdrawn',
					args: [owner, signer],
				}),
			]);
			return {delegate, withdrawn};
		},
		{
			// Slower than the message poll: this changes about once per account, so
			// the value of a tighter loop is nil and the cost is two reads.
			fetchInterval: params.fetchInterval ?? 15_000,
			source: {
				store: source,
				// The source is an object that is recreated on every notification,
				// so identity comparison would see every derived update as a change.
				// The scope is meaningful when either the owner or the signer moves.
				key: (scope) => (scope ? `${scope.owner}:${scope.signer}` : undefined),
			},
		},
	);
}