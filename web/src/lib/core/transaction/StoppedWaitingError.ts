/**
 * The user stopped waiting for a request the wallet still holds.
 *
 * NOT A FAILURE, and the distinction is the whole point. The transaction may
 * still be sent: the request is with the wallet, the dispatch is still running,
 * and its in-flight record is still open and will settle itself when the wallet
 * answers. What ended is the AWAIT, not the transaction.
 *
 * It exists because those two had been the same thing. A caller sending a
 * transaction holds a promise, and blocks its UI until that promise settles, so
 * a wallet that never answers left the Send button spinning for ever. Releasing
 * the user meant releasing the caller, and releasing the caller means settling
 * its promise, which for an operation with no outcome yet can only be a throw.
 *
 * So call sites treat it like the other not-really-errors they already know
 * (`InsufficientFundsError`, a user rejection, a connection refusal): stop
 * spinning, show no error, and change nothing the user typed. What became of the
 * transaction is reported separately, by the in-flight ledger, once there is
 * something true to say about it.
 */
export class StoppedWaitingError extends Error {
	constructor() {
		super(
			'Stopped waiting for the wallet. The request may still be with it, and ' +
				'approving it later will still send the transaction.',
		);
		this.name = 'StoppedWaitingError';
	}
}

/**
 * Whether this is the app releasing a caller rather than anything going wrong.
 *
 * A function rather than `instanceof` at each site, matching
 * `isUserRejectionError`, so the check survives the error crossing a bundle or
 * a realm boundary where class identity does not.
 */
export function isStoppedWaitingError(error: unknown): boolean {
	if (error instanceof StoppedWaitingError) return true;
	return (
		!!error &&
		typeof error === 'object' &&
		(error as {name?: unknown}).name === 'StoppedWaitingError'
	);
}
