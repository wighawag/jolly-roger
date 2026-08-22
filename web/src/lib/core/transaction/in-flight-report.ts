import {derived, type Readable} from 'svelte/store';
import {
	describeOutcome,
	isWorthReporting,
	type InFlightOutcome,
} from './in-flight';
import type {InFlightLedger, InFlightState} from './in-flight-store';

/**
 * What the in-flight notice SHOWS (ADR-0004, `work` branch).
 *
 * Separate from the ledger because the rule for WHAT TO SAY is the delicate part
 * and belongs where it can be tested. A record with no outcome is still in
 * flight and must stay silent, since the connection flow's own modal is already
 * on screen asking the user to confirm in their wallet, and a second dialog on
 * top of it would be the app contradicting itself.
 *
 * Wording only. When to ASK again, and what to do about a page that is closing,
 * live in ./in-flight-tracking.
 */

export type ReportedRequest = {
	id: string;
	/** Named the way the transaction list names it, so the two can be compared. */
	description: string;
	account: `0x${string}`;
	requestedAt: number;
	outcome: InFlightOutcome;
	/** The sentence to show. Comes from `describeOutcome`; see why it lives there. */
	message: string;
};

/**
 * The records the user should be told about: reconciled, and worth reporting.
 *
 * Oldest first, matching the order they were dispatched in, because that is the
 * order the user did things in and the only order they can reconstruct.
 */
export function reportedRequests(state: InFlightState): ReportedRequest[] {
	const reported: ReportedRequest[] = [];
	for (const request of state.requests) {
		const outcome = state.outcomes[request.id];
		// No outcome means this has not been reconciled: it is genuinely in
		// flight, and the wallet, not us, is the thing the user is waiting on.
		if (!outcome) continue;
		if (!isWorthReporting(outcome)) continue;
		reported.push({
			id: request.id,
			description: request.intent.description,
			account: request.account,
			requestedAt: request.requestedAt,
			outcome,
			message: describeOutcome(outcome),
		});
	}
	return reported;
}

/**
 * The heading for a set of reported requests.
 *
 * NOT A CONSTANT, because the notice can carry two quite different kinds of
 * news. Most of the time it is "we do not know whether this was sent", which is
 * a hedge and should read like one. But a `broadcast-not-recorded` entry is the
 * opposite: the app WATCHED it go and has the hash, and it is only missing from
 * the transaction list. Wrapping that in "may have been sent... never saw an
 * answer" makes the modal contradict its own body, which is exactly the kind of
 * detail that teaches a user the app does not know what it is talking about.
 *
 * Mixed sets get the hedge, because the hedge is true of at least one of them.
 *
 * NEVER "this transaction". The notice is almost always the first thing a user
 * sees after a reload, about a request from a session that is over, so "this"
 * points at nothing on the screen and reads as though the app has lost track of
 * what it is talking about. "A transaction" is what it is: one they made
 * earlier, which the app is now raising.
 */
export function reportHeading(reported: readonly ReportedRequest[]): {
	title: string;
	lead: string;
} {
	const several = reported.length > 1;
	const allObserved =
		reported.length > 0 &&
		reported.every(
			(request) => request.outcome.status === 'broadcast-not-recorded',
		);

	if (allObserved) {
		return {
			title: several
				? 'Transactions missing from your list'
				: 'A transaction is missing from your list',
			lead: several
				? 'They were sent and are on chain. The app could not add them to your transaction list, so what is missing is the record, not the transactions.'
				: 'It was sent and is on chain. The app could not add it to your transaction list, so what is missing is the record, not the transaction.',
		};
	}

	return {
		title: several
			? 'Some transactions may have been sent'
			: 'A transaction may have been sent',
		lead: several
			? 'Your wallet was asked to send them and never answered, so the app cannot say whether they went through.'
			: 'Your wallet was asked to send it and never answered, so the app cannot say whether it went through.',
	};
}

/** The same, as a store, for a component to render without deriving anything. */
export function createInFlightReport(
	ledger: InFlightLedger,
): Readable<ReportedRequest[]> {
	return derived(ledger, reportedRequests);
}
