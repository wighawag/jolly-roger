import {derived, get, type Readable} from 'svelte/store';
import {
	describeOutcome,
	isWorthReporting,
	type InFlightOutcome,
} from './in-flight';
import type {InFlightLedger, InFlightState} from './in-flight-store';

/**
 * What the in-flight notice shows, AND what keeps the ledger honest over a
 * session (ADR-0004, `work` branch).
 *
 * TWO JOBS, and the name only says the first. Reporting is the original one:
 * separate from the ledger because the rule for WHAT TO SAY is the delicate part
 * and belongs where it can be tested. A record with no outcome is still in
 * flight and must stay silent, since the connection flow's own modal is already
 * on screen asking the user to confirm in their wallet, and a second dialog on
 * top of it would be the app contradicting itself.
 *
 * The second job arrived with {@link startInFlightTracking}: a startup side
 * effect, a timer, an account subscription and an unload guard, moved out of
 * `createContext` because that is the file every adopter of this template reads
 * and it should not be where these are assembled. They belong beside the
 * reporting rules (both answer "when might we learn something new about a
 * request"), but the module name has not caught up, so it is said here rather
 * than left for the next reader to discover. Splitting this into
 * `in-flight-report.ts` and `in-flight-tracking.ts` is the tidy end state, and
 * is deliberately not bundled into a change that fixes defects.
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

/**
 * Whether the app is waiting on a dispatch RIGHT NOW.
 *
 * The condition `navigation.guardUnload` is registered on, and deliberately the
 * SAME fact the wallet-action modal and the escape hatch now rest on
 * (`dispatching`). Before, each of the three asked a different question, so they
 * could disagree: a modal could be up with no guard behind it, which is exactly
 * what was reported.
 *
 * Narrower than "the ledger has records", on purpose. A record restored from a
 * previous session is durable and has already been reported, so losing the page
 * cannot make it worse and warning about it would be nagging. A record the user
 * has stopped waiting on is likewise not something to hold them here for: they
 * said so. What is worth a prompt is a dispatch the app could still learn the
 * answer to, because a reload throws that answer away and costs a reconciliation
 * round trip. That round trip is the only thing the prompt ever saves.
 */
export function hasUnansweredRequest(state: InFlightState): boolean {
	return state.dispatching > 0;
}

/**
 * Whether an outcome could still turn into a better one, so it is worth asking
 * the chain again later.
 *
 * The distinction the watcher below rests on. Two of these are LIVE questions:
 * `nonce-free` says the request may still be sitting in the wallet, and the
 * moment the user approves it the node's nonce moves; `unreadable` says we could
 * not reach the chain, and chains come back. The rest are as settled as this app
 * can make them, and re-asking would be polling for an answer that cannot
 * change: `no-baseline` has nothing to compare against ever, `nonce-behind` is a
 * different chain, `nonce-consumed` is already the conclusion, and
 * `broadcast-not-recorded` was watched happening.
 */
export function isWatchable(outcome: InFlightOutcome | undefined): boolean {
	if (!outcome) return false;
	if (outcome.status !== 'unknown') return false;
	return outcome.reason === 'nonce-free' || outcome.reason === 'unreadable';
}

/**
 * Keep asking, while there is a question that could still be answered.
 * Returns a teardown.
 *
 * WHY THIS IS NOT OPTIONAL. The notice tells the user, truthfully, that the
 * request may still be waiting in their wallet and that "approving it later
 * would still send it". Reported from real use: they then DID approve it later,
 * and the app never noticed, because reconciliation ran once at startup and
 * never looked again. Promising that something still counts and then failing to
 * watch for it is worse than not saying it, because the user acts on it.
 *
 * BACKOFF, not a fixed interval. The answer arrives whenever the user gets round
 * to their wallet, which may be seconds or minutes, so this has to keep going;
 * and a tab left open on an unacknowledged notice must not poll a public RPC
 * every few seconds for ever. Doubling up to a ceiling covers the common case
 * quickly and then costs almost nothing.
 *
 * It stops on its own when no question is left worth asking, which includes the
 * user acknowledging the notice.
 */
export function watchUnresolvedRequests(params: {
	ledger: Readable<InFlightState> & Pick<InFlightLedger, 'reconcile'>;
	/** First delay after an unresolved outcome appears. */
	intervalMs?: number;
	/** Ceiling the doubling stops at. */
	maxIntervalMs?: number;
}): () => void {
	const {ledger, intervalMs = 5_000, maxIntervalMs = 60_000} = params;

	let timer: ReturnType<typeof setTimeout> | undefined;
	let delay = intervalMs;
	let stopped = false;
	let watchable = false;

	function schedule() {
		if (stopped || timer || !watchable) return;
		timer = setTimeout(() => {
			timer = undefined;
			// Doubling BEFORE the pass, so a reconcile that changes nothing does not
			// reset it by way of the subscription below.
			delay = Math.min(delay * 2, maxIntervalMs);
			void Promise.resolve(ledger.reconcile())
				.catch(() => {})
				.then(() => schedule());
		}, delay);
	}

	const unsubscribe = ledger.subscribe((state) => {
		const next = state.requests.some((request) =>
			isWatchable(state.outcomes[request.id]),
		);
		// A fresh question deserves a prompt first look, so the backoff restarts
		// when there was nothing to watch and now there is.
		if (next && !watchable) delay = intervalMs;
		watchable = next;
		if (!watchable && timer) {
			clearTimeout(timer);
			timer = undefined;
		}
		schedule();
	});

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		timer = undefined;
		unsubscribe();
	};
}

/**
 * Reconcile again whenever an account arrives or changes. Returns a teardown.
 *
 * WHY A SECOND PASS. Reconciliation runs at startup, which is before the wallet
 * has reconnected, so the one question with a quiet answer, "does the app
 * already hold an operation at this nonce?", is unanswerable: account data is
 * per account and restored asynchronously, and with no account there is nothing
 * to read. The startup pass therefore falls back to comparing nonces, and the
 * user is told a transaction might have been sent while it sits in their list.
 *
 * Reported exactly that way: "on reload, it does not reconcile".
 *
 * Extracted from the context so it can be tested. Wiring that lives only inside
 * `createContext` is wiring nothing can check, and this one is invisible when it
 * breaks: everything still works, the app is just needlessly vague.
 */
export function reconcileWhenAccountArrives(params: {
	account: Readable<`0x${string}` | undefined>;
	ledger: Pick<InFlightLedger, 'reconcile'>;
}): () => void {
	const {account, ledger} = params;
	let reconciledFor: string | undefined;
	return account.subscribe(($account) => {
		// Only on a real change, so an account store that re-emits the same value
		// does not turn into a reconciliation loop against the node.
		if (!$account || $account === reconciledFor) return;
		reconciledFor = $account;
		void ledger.reconcile();
	});
}

/**
 * Everything that keeps the ledger honest over a session, started as one thing.
 * Returns a single teardown.
 *
 * These four belong together and were four separate blocks in `createContext`,
 * which is the file every adopter of this template has to read to understand
 * their app. Each is a different answer to "when might we learn something new
 * about a request we have not heard back about":
 *
 * - at startup, for records a previous session left behind;
 * - when an account arrives, because only then can the app tell whether it
 *   ALREADY holds an operation at that nonce, which is the one quiet answer;
 * - on a timer while an outcome could still change, because the notice promises
 *   that approving later still sends it, so something has to be watching;
 * - before the page is lost, as a courtesy, which is the only one that is not
 *   about learning something.
 *
 * The unload guard is registered here rather than in the context because it is
 * registered FROM DOMAIN STATE (see ADR-0004), and this is where that state
 * lives. Passing the capability in keeps this module free of any opinion about
 * how the app navigates.
 */
export function startInFlightTracking(params: {
	ledger: InFlightLedger;
	account: Readable<`0x${string}` | undefined>;
	navigation: {guardUnload: (shouldBlock: () => boolean) => () => void};
}): () => void {
	const {ledger, account, navigation} = params;

	// Not awaited, and allowed to fail: it waits for account data to be restored,
	// and nothing else in startup should wait for it.
	void ledger.reconcile();

	const stopWatchingAccount = reconcileWhenAccountArrives({account, ledger});
	const stopWatchingRequests = watchUnresolvedRequests({ledger});
	const stopGuardingUnload = navigation.guardUnload(() =>
		hasUnansweredRequest(get(ledger)),
	);

	return () => {
		stopWatchingAccount();
		stopWatchingRequests();
		stopGuardingUnload();
	};
}
