import type {
	BroadcastedTransaction,
	TransactionIntent,
} from '@etherkit/tx-observer';
import type {OnchainOperation, OperationAttempt} from './AccountData';

/**
 * As much of an operation as the projection reads, with `attempts` accepted
 * READONLY.
 *
 * Synqable hands out deeply-readonly snapshots, and a projection is exactly the
 * kind of pure read that should be able to take one. Naming the input this way
 * costs one type and removes a cast at every debug/inspection call site, where
 * a cast is most likely to be the thing that hides a real mismatch.
 */
export type ProjectableOperation = {
	call: OnchainOperation['call'];
	attempts: readonly OperationAttempt[];
	state?: OnchainOperation['state'];
	expectedUpdate?: OnchainOperation['expectedUpdate'];
};

/**
 * THE OBSERVER'S VIEW OF AN OPERATION, BUILT ON DEMAND.
 *
 * The store holds what the app knows: the call, one entry per broadcast, and
 * whatever the observer last said about each. `TransactionIntent` is the shape
 * the observer wants that in, so it is DERIVED here rather than stored beside
 * the fields it is derived from.
 *
 * Storing both is what the restructure removed. It meant the same transaction
 * existed twice, in two shapes, and the two could disagree: an observer update
 * arriving with the intent's own `transactions` array would replace the stored
 * one wholesale, taking the dispatch facts (gas parameters, source, calldata)
 * with it. Deriving makes that unrepresentable, because there is nothing to
 * overwrite.
 *
 * `nonceObserved` is DELIBERATELY NOT PROJECTED. Only the observer may set it
 * (it means "this nonce came from the chain, not from us"), the app never
 * stores it, and the observer re-derives it in one tick after a reload. Passing
 * a value the app made up would let a supplied nonce declare a transaction
 * Dropped on the strength of nothing.
 */
export function toTransactionIntent(
	operation: ProjectableOperation,
): TransactionIntent {
	const {call, attempts, state, expectedUpdate} = operation;

	const transactions: BroadcastedTransaction[] = attempts.map((attempt) => ({
		// From the call, because they cannot differ between attempts: the same
		// account sends the same bytes to the same chain, at a higher price.
		chainId: call.chainId,
		from: call.from,
		// From the attempt, because these are the whole reason attempts is a list.
		hash: attempt.hash,
		nonce: attempt.nonce,
		broadcastTimestampMs: attempt.broadcastTimestampMs,
		// Joined back to the attempt it belongs to. This is the pairing the
		// observer matches by hash on the way in and on the way out.
		state: attempt.state,
	}));

	return {transactions, state, expectedUpdate};
}
