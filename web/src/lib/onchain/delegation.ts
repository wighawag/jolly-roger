import {
	createPollingStore,
	type PollingStore,
	type PollingValue,
} from '$lib/core/connection/polling-store';
import {derived, type Readable} from 'svelte/store';
import type {PublicClient} from 'viem';

/**
 * The delegation surface, declared here rather than read off an app's ABI.
 *
 * These five functions are the external surface of
 * `contracts/src/core/UsingDelegation.sol`, which is fixed for anything that
 * adopts the library. Nothing about them is app-specific, so reaching them
 * through one app's named contract would leave every descendant of this
 * template either keeping a contract by that name or forking this file. The
 * ABI of the FEATURE belongs to the feature; WHICH contract carries it belongs
 * to the app, and arrives as an address (see `createDelegationState`).
 *
 * Only what this module and its writers call: the two reads, and the three
 * entry points behind registering and withdrawing. `delegationMessage` and
 * `delegationDigest` are deliberately absent - the text an owner signs is
 * built off chain by the connect library (see ui/delegation/registration), so
 * declaring a way to read it here would invite a second source for a string
 * that has to match byte for byte.
 */
export const DELEGATION_ABI = [
	{
		inputs: [{internalType: 'address', name: 'owner', type: 'address'}],
		name: 'delegateOf',
		outputs: [{internalType: 'address', name: '', type: 'address'}],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{internalType: 'address', name: 'owner', type: 'address'},
			{internalType: 'address', name: 'delegate', type: 'address'},
		],
		name: 'delegationWithdrawn',
		outputs: [{internalType: 'bool', name: '', type: 'bool'}],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{internalType: 'address', name: 'delegate', type: 'address'},
			{internalType: 'address payable', name: 'payee', type: 'address'},
		],
		name: 'registerDelegate',
		outputs: [],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		inputs: [
			{internalType: 'address', name: 'owner', type: 'address'},
			{internalType: 'string', name: 'origin', type: 'string'},
			{internalType: 'address', name: 'delegate', type: 'address'},
			{internalType: 'bytes', name: 'signature', type: 'bytes'},
		],
		name: 'registerDelegateViaSignature',
		outputs: [],
		stateMutability: 'payable',
		type: 'function',
	},
	{
		inputs: [],
		name: 'revokeDelegate',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const;

/**
 * The contract this app's delegation lives in: the one that adopted
 * {UsingDelegation}, addressed with the surface above.
 *
 * Carried on the store so that everything touching delegation - the read here,
 * the registration in the top-up flow, the withdrawal in the account panel -
 * addresses the SAME contract. Every writer has to write to the contract the
 * reader just answered about, and two independent lookups is two chances to
 * disagree. That disagreement is invisible in the worst way: a UI stating the
 * browser is already authorised while sends keep reverting, or a registration
 * that spends the user's money and leaves the send it was unblocking still
 * blocked.
 */
export type DelegationRegistry = {
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
export type DelegationStore = PollingStore<DelegationState> & {
	/** The contract this state was read from, for whoever has to write to it. */
	readonly registry: DelegationRegistry;
};

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
type DelegationScope =
	| {
			owner: `0x${string}`;
			signer: `0x${string}`;
	  }
	| undefined;

export function createDelegationState(params: {
	publicClient: PublicClient;
	/**
	 * The contract that adopted {UsingDelegation}.
	 *
	 * An address rather than a deployments object: only the app knows which of
	 * its contracts carries the library, and the surface is already known here.
	 */
	registry: `0x${string}`;
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
	const {publicClient, account, signer, fetchGate} = params;
	const registry: DelegationRegistry = {
		address: params.registry,
		abi: DELEGATION_ABI,
	};

	// The polling engine takes ONE source, so the account, the signer and the
	// gate are folded into one: a closed gate reads as "no account to look up",
	// which is already the state that stops the fetch and resets the value.
	// The signer is part of the scope because `delegationWithdrawn` is now
	// keyed per delegate - a change in the signer (e.g. after re-derivation)
	// changes the answer.
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

	// The registry travels WITH the state read from it, so a writer never has to
	// look the contract up a second time. See DelegationRegistry.
	return Object.assign(store, {registry});
}
