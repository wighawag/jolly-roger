import {BaseError} from 'viem';
import {messageOf} from '$lib/core/utils/format/error';
import {bigIntReplacer} from '$lib/core/utils/format/json';
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
	// A `message` off a PLAIN OBJECT counts too, not just off an `Error`. A
	// failure that never went through viem and was never constructed as an
	// `Error` - a rejected JSON-RPC payload handed straight to a catch block -
	// used to fall past this to the constant below, so the node's own
	// explanation was dropped in favour of "Transaction failed".
	//
	// A thrown PRIMITIVE deliberately still falls through. `throw 'boom'` is a
	// developer's stray string, not a sentence to show a user, and this summary
	// goes in a toast. `errorMessage` is the reader for the other case (a
	// diagnostic trace), where seeing it verbatim is the point.
	const message = messageOf(error);
	if (message) return message.split('\n')[0].trim();

	return 'Transaction failed';
}

/** The full error text, for a "show details" affordance. */
export function txErrorDetails(error: unknown): string {
	if (error instanceof Error) return error.message;
	// `String()` on a plain object is `[object Object]`, which is the single
	// least useful thing a "show details" panel can contain: the user opened it
	// precisely because the summary was not enough. Serialise it instead, and
	// fall back to the summary's own reading if it will not serialise (a cycle,
	// a bigint, a getter that throws).
	if (typeof error === 'object' && error !== null) {
		try {
			const json = JSON.stringify(error, bigIntReplacer, 2);
			// An object whose every field is non-enumerable serialises to `{}`,
			// which is no better than what this branch exists to avoid.
			if (json && json !== '{}') return json;
		} catch {
			// A cycle, or a getter that throws. Fall through to the message.
		}
		return messageOf(error) ?? String(error);
	}
	return String(error);
}
