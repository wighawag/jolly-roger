/**
 * @file Recognise, after the fact, that a transaction failed because the
 * account sending it could not pay for it.
 *
 * `balanceCheck.ensureCanAfford` answers the same question BEFORE sending, and
 * is the right tool for a user-initiated purchase: it opens a modal for the
 * duration of the call. That makes it the wrong tool for anything an app sends
 * on the user's behalf, because a modal appearing for every background
 * transaction is exactly the interruption a local signer exists to remove. An
 * app on that path has to recognise the shortfall from the FAILURE instead, and
 * only then offer a remedy. Without this, every such app matches on message
 * text itself, badly and differently.
 *
 * The remedy is deliberately not here. Which account to top up, and from what,
 * is the app's business; this only names the problem. Kept a pure function of
 * one value for the same reason: it has to be callable from a catch block
 * anywhere, including one with no access to stores or app context.
 */
import {
	ContractFunctionRevertedError,
	ExecutionRevertedError,
	InsufficientFundsError as ViemInsufficientFundsError,
} from 'viem';
import {InsufficientFundsError} from './InsufficientFundsError';

/**
 * Errors whose presence anywhere in the chain means the transaction was
 * EXECUTED and rejected by a contract, not refused for lack of funds.
 *
 * This guard matters more than it looks. "insufficient funds" is one of the
 * most common revert strings there is (every ERC20 and every paywalled
 * function says something like it), and a revert reason is arbitrary text
 * chosen by a contract author, which lands in the same `message` field this
 * module reads. Matching it would offer the user a top-up that cannot fix
 * anything, which is the failure mode worth spending code to avoid: a MISSED
 * match only costs a generic error message, a WRONG match sends someone to buy
 * gas they already have.
 */
function isRevert(value: unknown): boolean {
	return (
		value instanceof ContractFunctionRevertedError ||
		value instanceof ExecutionRevertedError
	);
}

/**
 * The same conclusion from prose, for the reverts viem never got to model
 * (anything already flattened into a plain `Error` by an intermediate layer).
 */
const REVERT_TEXT = /execution reverted|reverted with|revert reason/i;

/**
 * The node's own wording for "this account cannot pay".
 *
 * Matching on prose is unpleasant and is done anyway, because there is no
 * structured signal to match on instead. viem only classifies a node error
 * (into {@link ViemInsufficientFundsError}) for the JSON-RPC codes listed in
 * its `containsNodeError`, and hardhat reports this one under -32602, which is
 * not among them: on the local node the class is never constructed and the
 * only evidence left is the sentence hardhat wrote.
 *
 * The nodes do not agree on that sentence. Hardhat says "Sender doesn't have
 * enough funds to send tx"; geth and the many clients that copy its wording say
 * "insufficient funds for gas * price + value". Both are covered, broadly,
 * because breadth is the cheap direction to be wrong in (see {@link isRevert}).
 *
 * Each node gets TWO anchors, one per sentence, which is redundant today and
 * deliberately so: a node rewording its prose is the expected way this module
 * decays, and it is unlikely to reword both halves at once. Every pattern here
 * is pinned by a test on its own, so a dead one can be recognised as dead
 * rather than kept out of superstition.
 */
const PATTERNS = [
	// geth and the clients that copy it, one anchor per sentence half
	/insufficient funds/i,
	/gas \* price \+ value/i,
	// hardhat, likewise
	/have enough funds/i, // matches both "doesn't have" and "does not have"
	/max upfront cost/i,
	// the wording viem itself recognises, from besu/nethermind
	/exceeds transaction sender account balance/i,
];

/**
 * How far to follow `cause` before giving up.
 *
 * viem wraps the useful wording several layers deep and puts a category on the
 * outside ("An unknown RPC error occurred", "Invalid parameters were provided
 * to the RPC method"), so reading one level answers the wrong question.
 *
 * This bound is the whole termination guarantee, including for a cyclic chain:
 * nothing about `cause` promises a chain is acyclic, and this runs on the error
 * path, where hanging would replace a message the user could act on with a
 * frozen screen. Ten is comfortably past the deepest real viem nesting.
 */
const MAX_DEPTH = 10;

/** The error and its causes, flattened, cycle-safe and depth-bounded. */
function causeChain(error: unknown): unknown[] {
	const chain: unknown[] = [];
	const seen = new Set<object>();
	let current: unknown = error;

	while (
		current !== undefined &&
		current !== null &&
		chain.length < MAX_DEPTH
	) {
		if (typeof current === 'object') {
			// Stops a cycle as soon as it closes instead of re-reading the same few
			// objects up to the depth bound. Deliberately belt-and-braces: it cannot
			// change the answer (a cycle exposes no value the first lap did not), so
			// no test can pin it, and MAX_DEPTH above is what actually guarantees
			// this returns. Kept because that bound is a number someone may raise.
			if (seen.has(current)) break;
			seen.add(current);
		}
		chain.push(current);
		current =
			typeof current === 'object'
				? (current as {cause?: unknown}).cause
				: undefined;
	}

	return chain;
}

/**
 * Every string one level might have hidden the node's wording in. viem spreads
 * it across three fields depending on how far up the wrapping we are, so all
 * three are read rather than guessing which layer this is.
 */
function textOf(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value !== 'object' || value === null) return '';

	const candidate = value as {
		shortMessage?: unknown;
		message?: unknown;
		details?: unknown;
	};
	return [candidate.shortMessage, candidate.message, candidate.details]
		.filter((part): part is string => typeof part === 'string')
		.join('\n');
}

/**
 * Whether a failure was the sending account being unable to pay.
 *
 * Total: any value can be thrown, and this is called from catch blocks that are
 * already reporting a failure, so `undefined`, `null`, `{}`, strings and
 * numbers all answer `false` rather than throwing a second error over the first.
 *
 * Also true for {@link InsufficientFundsError}, the shortfall this app detected
 * itself before sending, so one predicate answers "could this account pay?"
 * whichever side of the send it was decided on. Note that a call site treating
 * a dismissed funds modal as a CANCELLATION must keep checking for that first:
 * this says what went wrong, not whether to report it.
 */
export function isInsufficientFundsFailure(error: unknown): boolean {
	if (error instanceof InsufficientFundsError) return true;

	const chain = causeChain(error);

	// Structured first, on the chains where viem did classify the node error.
	if (chain.some((level) => level instanceof ViemInsufficientFundsError)) {
		return true;
	}

	// Before any prose is read, not after: viem copies the revert reason up into
	// the wrapper's `message`, so a contract that reverts with "insufficient
	// funds" would otherwise match on the outermost layer and never reach the
	// revert error further down that explains what it really was.
	if (
		chain.some(isRevert) ||
		chain.some((level) => REVERT_TEXT.test(textOf(level)))
	) {
		return false;
	}

	return chain.some((level) => {
		const text = textOf(level);
		return text !== '' && PATTERNS.some((pattern) => pattern.test(text));
	});
}
