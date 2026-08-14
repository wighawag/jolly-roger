import {DELEGATION_ABI} from '@etherplay/connect';
import {
	createPollingStore,
	type PollingStore,
	type PollingValue,
} from '$lib/core/connection/polling-store';
import {derived, type Readable} from 'svelte/store';
import type {PublicClient} from 'viem';

/**
 * The delegation surface comes from the package that DEFINES it.
 *
 * It used to be hand-written here, which was the wrong place for it twice over:
 * the ABI is not app-specific (it is fixed for anything adopting the library),
 * and a hand-maintained copy of a contract's surface is a copy that drifts. It
 * now travels with the Solidity and the message builder in one package,
 * `@etherplay/delegation`, where a test pins the three together against a
 * shared vectors file.
 *
 * Imported from `@etherplay/connect` rather than from that package directly,
 * and so the web has no dependency on it: connect re-exports the whole feature
 * (this, `delegationMessage`, `findSavedDelegation`) precisely so an app has
 * one import and cannot end up with two versions of the message. The contracts
 * workspace depends on the package itself, for the Solidity.
 *
 * Re-exported here so the rest of the app keeps importing the feature from one
 * place, whatever the package is called.
 */
export {DELEGATION_ABI};

/**
 * The contract this app's delegation lives in: the one that adopted
 * {UsingDelegation}, addressed with the surface above, on the chain it is
 * deployed to.
 *
 * THE PAIR IS THE UNIT. The contract's own address and the chain id are inside
 * the message the owner signs, so a credential is worth nothing at any other
 * contract or on any other chain. Which is also why the two travel together
 * here: the chain read, the writers and the lookup that picks the credential
 * out of `savedDelegations` must all mean the same (chainId, contract), and
 * three independent lookups is three chances to disagree.
 *
 * That disagreement is invisible in the worst way: a UI stating the browser is
 * already authorised while sends keep reverting, or a registration that spends
 * the user's money and leaves the send it was unblocking still blocked.
 */
export type DelegationRegistry = {
	readonly chainId: number;
	readonly address: `0x${string}`;
	readonly abi: typeof DELEGATION_ABI;
};

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
 * ONE read answers both halves. `delegationStatus(owner, delegate)` is a single
 * cold SLOAD for the pair, and it replaced a `delegateOf` whose answer was
 * compared against this browser's signer and then thrown away, plus a second
 * call for the withdrawal. An account may have SEVERAL delegates now, so there
 * is no single address to return anyway.
 */
export type DelegationState = {
	/** Whether this browser's signer may act for the account, right now. */
	allowed: boolean;
	/**
	 * Whether the account has withdrawn its authorisation for this signer.
	 *
	 * PER DELEGATE: set only by a successful `revokeDelegate` for that delegate,
	 * and cleared only by an owner-sent `registerDelegate`. So once it is up the
	 * signature route for THAT delegate is closed, but a different delegate can
	 * still be authorised by a fresh signature - which is what lets a user
	 * replace one signer with another without sending a transaction themselves.
	 */
	withdrawn: boolean;
};

export type DelegationValue = PollingValue<DelegationState>;
export type DelegationStore = PollingStore<DelegationState> & {
	/** The contract this state was read from, for whoever has to write to it. */
	readonly registry: DelegationRegistry;
};

/**
 * Whether this browser's signer is currently a delegate of the account.
 *
 * A FIELD READ, not an address comparison: the read is already scoped to the
 * (owner, signer) pair, so the contract has answered the question about this
 * signer rather than about whichever delegate happens to be first in a list.
 *
 * Unknown reads as NOT registered, deliberately. The consequence of guessing
 * wrong in that direction is a prompt to register that turns out to be
 * unnecessary; guessing the other way sends a transaction that reverts.
 */
export function isRegistered(value: DelegationValue): boolean {
	return value.step === 'Loaded' && value.allowed;
}

/** What the polling engine fetches: the account and its signer as one scope. */
type DelegationScope =
	| {
			owner: `0x${string}`;
			signer: `0x${string}`;
	  }
	| undefined;

export function createDelegationState(params: {
	publicClient: PublicClient;
	/**
	 * The contract that adopted {UsingDelegation}, and the chain it is on.
	 *
	 * An address rather than a deployments object: only the app knows which of
	 * its contracts carries the library, and the surface is already known here.
	 * The chain id comes with it because the credential is bound to the pair.
	 */
	registry: `0x${string}`;
	chainId: number;
	/** The authenticated account. The read is scoped to it, and resets with it. */
	account: Readable<`0x${string}` | undefined>;
	/**
	 * This browser's signer address. The read is scoped to it, because both
	 * halves of the answer are per delegate: a withdrawn signer does not block a
	 * different one, and neither does an authorised one authorise it.
	 */
	signer: Readable<`0x${string}` | undefined>;
	/** Optional gate, for an app that can only reach the chain via the wallet. */
	fetchGate?: Readable<boolean>;
	fetchInterval?: number;
}): DelegationStore {
	const {publicClient, account, signer, fetchGate} = params;
	const registry: DelegationRegistry = {
		chainId: params.chainId,
		address: params.registry,
		abi: DELEGATION_ABI,
	};

	// The polling engine takes ONE source, so the account, the signer and the
	// gate are folded into one: a closed gate reads as "no account to look up",
	// which is already the state that stops the fetch and resets the value.
	// The signer is part of the scope because the status is keyed per delegate -
	// a change in the signer (e.g. after re-derivation) changes the answer.
	const source: Readable<DelegationScope> = fetchGate
		? derived([account, signer, fetchGate], ([$account, $signer, $open]) =>
				$open && $account && $signer
					? {owner: $account, signer: $signer}
					: undefined,
			)
		: derived([account, signer], ([$account, $signer]) =>
				$account && $signer ? {owner: $account, signer: $signer} : undefined,
			);

	const store = createPollingStore(
		async (scope: DelegationScope) => {
			// Never reached with an absent scope: the engine treats a falsy source as
			// "nothing to fetch". Narrowed for the type rather than for the case.
			if (!scope) throw new Error('no account to read delegation for');
			const {owner, signer} = scope;
			const [allowed, withdrawn] = await publicClient.readContract({
				address: registry.address,
				abi: registry.abi,
				functionName: 'delegationStatus',
				args: [owner, signer],
			});
			return {allowed, withdrawn};
		},
		{
			// Slower than the message poll: this changes about once per account, so
			// the value of a tighter loop is nil.
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

	// The registry travels WITH the state read from it, so a writer never has to
	// look the contract up a second time. See DelegationRegistry.
	return Object.assign(store, {registry});
}
