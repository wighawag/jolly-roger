import {BaseError} from 'viem';
import {isInsufficientFundsFailure} from './insufficient-funds-failure';

/**
 * What the app says when an account cannot pay, in its own words.
 *
 * Exported because it is the one failure with a remedy attached: a caller that
 * offers a top-up wants to state the problem in the same terms the toast did.
 */
export const INSUFFICIENT_FUNDS_SUMMARY =
	'This account does not have enough funds to pay for this transaction.';

/**
 * viem shortMessages that describe a CATEGORY rather than a cause.
 *
 * They come from mapping a JSON-RPC error CODE, and a node is free to return a
 * generic code with a specific message: "replacement transaction underpriced"
 * arrives under -32603, which viem renders as "An internal error was received".
 * The user is told the app broke, about something they could have fixed by
 * waiting or by bumping the fee.
 *
 * Only these are overridden, rather than always preferring `details`, because
 * for errors viem models properly (a contract revert, a user rejection) its
 * shortMessage is the better sentence and the node's raw text is the worse one.
 *
 * The worked example here USED to be hardhat's insufficient funds under -32602,
 * which is where this mechanism came from. That one is now answered above, by
 * name, rather than by forwarding hardhat's phrasing to the user. This remains
 * for every other category, so it is deliberately not narrowed to the codes
 * that are left.
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
export function txErrorSummary(error: unknown): string {
	// Asked before viem is consulted, because for this one failure viem's answer
	// is actively misleading rather than merely vague: a node is free to report a
	// specific problem under a generic JSON-RPC code, and hardhat reports an
	// empty account under -32602, which viem faithfully renders as "Invalid
	// parameters were provided to the RPC method". Telling someone to check their
	// parameters is worse than telling them nothing. Every other error keeps
	// viem's wording below, which is better than the node's raw text.
	if (isInsufficientFundsFailure(error)) return INSUFFICIENT_FUNDS_SUMMARY;

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
