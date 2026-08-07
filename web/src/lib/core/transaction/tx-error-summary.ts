import {BaseError} from 'viem';

/**
 * Produce a short, human-friendly summary of a transaction error.
 *
 * viem errors carry a full multi-line dump (request args, docs link, version)
 * that is useful for debugging but overwhelming in a toast. viem's `BaseError`
 * exposes `shortMessage` (a single-sentence cause); prefer that. Fall back to
 * the first line of a generic error message, then a generic string.
 *
 * The full text remains available via {@link txErrorDetails} for a
 * details/expand affordance.
 */
/**
 * viem shortMessages that describe a CATEGORY rather than a cause.
 *
 * They come from mapping a JSON-RPC error CODE, and a node is free to return a
 * generic code with a specific message: hardhat reports "Sender doesn't have
 * enough funds" under -32602, which viem faithfully renders as "Invalid
 * parameters were provided to the RPC method". The user is then told to check
 * their parameters about a transaction whose only problem is an empty account.
 *
 * Only these are overridden, rather than always preferring `details`, because
 * for errors viem models properly (a contract revert, a user rejection) its
 * shortMessage is the better sentence and the node's raw text is the worse one.
 */
const UNINFORMATIVE_SHORT_MESSAGE =
	/invalid parameters|internal error|unknown rpc error/i;

/** The node's own explanation, from the deepest error that carries one. */
function nodeDetails(error: BaseError): string | undefined {
	const withDetails = error.walk(
		(e) => e instanceof BaseError && !!e.details,
	) as BaseError | null;
	const details = withDetails?.details?.trim();
	return details || undefined;
}

export function txErrorSummary(error: unknown): string {
	if (error instanceof BaseError) {
		// walk to the deepest shortMessage (most specific cause)
		const short = error.walk(
			(e) => e instanceof BaseError && !!e.shortMessage,
		) as BaseError | null;
		const shortMessage = short?.shortMessage || error.shortMessage;
		if (shortMessage) {
			if (UNINFORMATIVE_SHORT_MESSAGE.test(shortMessage)) {
				const details = nodeDetails(error);
				if (details) return details.split('\n')[0].trim();
			}
			return shortMessage;
		}
	}
	if (error instanceof Error && error.message) {
		return error.message.split('\n')[0].trim();
	}
	return 'Transaction failed';
}

/** The full error text, for a "show details" affordance. */
export function txErrorDetails(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
