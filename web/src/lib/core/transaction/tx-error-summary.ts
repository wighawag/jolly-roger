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
		if (short?.shortMessage) return short.shortMessage;
		if (error.shortMessage) return error.shortMessage;
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
