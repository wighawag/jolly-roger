/**
 * @file Reading a thrown value that may be wrapped several layers deep.
 *
 * Every "what actually went wrong?" question about a transaction has the same
 * two problems underneath it, and they belong here rather than in each asker:
 * the cause is nested (viem wraps the useful thing and puts a category on the
 * outside), and the wording is spread across three fields depending on how far
 * up the wrapping you are.
 *
 * Extracted from `insufficient-funds-failure`, which had both to itself until
 * the delegation registration needed the same walk to recognise a refused
 * credential. Two copies of a cycle-safe cause walk is one copy too many, and
 * the second one had already started to drift: it read `message` alone, so a
 * revert whose name only reached `shortMessage` would have been missed.
 */

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
export function causeChain(error: unknown): unknown[] {
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
export function textOf(value: unknown): string {
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
 * The custom error a contract reverted with, when viem managed to decode one.
 *
 * The STRUCTURED answer, and worth asking for before any prose is read: it is
 * the contract's own name for what happened, rather than a sentence somebody
 * chose to render it with.
 */
export function revertedErrorNames(error: unknown): string[] {
	return causeChain(error)
		.map((level) =>
			typeof level === 'object' && level !== null
				? (level as {data?: {errorName?: unknown}}).data?.errorName
				: undefined,
		)
		.filter((name): name is string => typeof name === 'string');
}
