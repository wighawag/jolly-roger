import {writable, type Readable} from 'svelte/store';
import {randomId} from '$lib/core/utils/web/random-id';
import {StoppedWaitingError} from './StoppedWaitingError';
import {
	isInFlightRequest,
	reconcileRequest,
	type InFlightIntent,
	type InFlightOutcome,
	type InFlightRequest,
} from './in-flight';

/**
 * The in-flight ledger: durable records of transaction requests the app has
 * dispatched and not yet seen the end of (ADR-0004, `work` branch).
 *
 * See ./in-flight for what a record means and why an unsettled one is UNKNOWN
 * rather than failed. This is the part with the side effects: storage, a clock,
 * and the two chain reads reconciliation needs. All of them are injected, so the
 * rules stay testable without a browser and without a node.
 *
 * ORDER IS THE WHOLE POINT. `record()` writes to storage BEFORE it does anything
 * that can fail, hang, or be interrupted, because the window this exists to
 * cover is exactly the one where the next line never runs. Everything else here
 * (the baseline nonce, the settle, the reconcile) is an improvement on a record
 * that is already safe.
 */

/** The slice of `Storage` we use, so tests can pass a plain object. */
export type InFlightStorage = Pick<
	Storage,
	'getItem' | 'setItem' | 'removeItem'
>;

/**
 * Storage that forgets, for where there is none: the server and prerendering,
 * which construct the context like everything else (ADR-0002). Inert rather
 * than absent, so no caller has to null-check a ledger, and nothing is written
 * anywhere a later browser session could mistake for a real record.
 */
export function ephemeralStorage(): InFlightStorage {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
		},
		removeItem: (key) => {
			items.delete(key);
		},
	};
}

export type InFlightState = {
	/**
	 * Records with no observed outcome, oldest first. A record is here from just
	 * before dispatch until the app either sees what happened or the user
	 * acknowledges that it never will.
	 */
	requests: readonly InFlightRequest[];
	/**
	 * What reconciliation concluded, by request id. Absent while a request is
	 * genuinely in flight, which is the case the connection flow's own modal is
	 * already on screen for: this must not put a second dialog on top of it.
	 */
	outcomes: Readonly<Record<string, InFlightOutcome>>;
	/**
	 * How many dispatches are STILL BEING AWAITED right now: ACTUALLY SENT to the
	 * wallet, no answer yet, and nobody has given up on them.
	 *
	 * Counted from {@link InFlightHandle.dispatched}, not from `record()`, and the
	 * gap between the two matters. `record()` persists first and then reads a
	 * baseline nonce, which can take up to `baselineTimeoutMs`; during that window
	 * the wallet has not been asked for anything. Counting from `record()` put
	 * "Please confirm the request in your wallet" on screen, with an escape hatch,
	 * for a request the wallet did not have yet: invisible against a local node,
	 * and a four-second falsehood against a slow public RPC.
	 *
	 * The app's own answer to "is a transaction being awaited at this moment", and
	 * deliberately the single source for the things that used to disagree about
	 * it: whether to offer the escape hatch, whether to warn before a reload, and
	 * whether to show that something is being sent. The wallet-action modal used
	 * to rest on it too and now rests on {@link prompting}, because that modal
	 * asks a narrower question than the other three.
	 *
	 * NOT A SUBSTITUTE FOR `wallet.pendingRequests`, and no longer a workaround for
	 * it. It was one: until @etherplay/connect 0.10.0 every wallet-state rebuild
	 * asserted `pendingRequests: []` and erased an outstanding request permanently,
	 * so this count was the only thing left standing
	 * (work/notes/observations/wallet-action-required-modal-not-seen.md). That is
	 * fixed upstream. What this still answers, and that list structurally cannot,
	 * is what the APP is waiting on: a send signed by a key the app holds itself is
	 * never a wallet request at all, and none of the three consumers above may go
	 * quiet for it. See `core/connection/wallet-activity` for which preference now
	 * rests on which reason.
	 *
	 * In memory only: after a reload nothing is being awaited, whatever records
	 * survived, and those are reported by the notice instead.
	 */
	dispatching: number;
	/**
	 * How many of those dispatches are waiting on A HUMAN AT A WALLET.
	 *
	 * NOT DERIVABLE FROM {@link dispatching}, which is the whole reason it is
	 * carried separately. "a dispatch is outstanding" and "a person has to go and
	 * approve something" are the same fact only while every sender is a wallet.
	 * An app that also signs with a key it holds itself (a local signer) sends
	 * silently, and inferring the second from the first put "Wallet Action
	 * Required" on screen for transactions no wallet and no human was involved in:
	 * several flashes a minute in a game with a short round loop.
	 *
	 * Recorded at dispatch time instead, from `guardDispatch`'s `prompts` option,
	 * because the place that BUILDS the client is the one place that knows whether
	 * the thing prompts. Always <= `dispatching`.
	 *
	 * THE NARROW QUESTION, and the only one this answers: which dispatches justify
	 * telling the user to go and look at their wallet. Everything else that keys
	 * on activity keeps reading `dispatching`, and should: the unload guard,
	 * because a silent transaction in flight is still an excellent reason not to
	 * close the tab, and the sending indicator, which exists precisely to explain
	 * that guard for the silent case.
	 */
	prompting: number;
};

/**
 * Handed back by `record()`, and the only way to settle that record.
 *
 * Three verbs, and the missing fourth is deliberate: there is no `failed()`.
 * An error that is not an observed rejection tells us nothing about whether the
 * transaction was broadcast, so it maps to {@link InFlightHandle.leaveUnresolved}
 * and the record stays for reconciliation.
 */
export type InFlightHandle = {
	id: string;
	/**
	 * The request has now actually been handed to the wallet. Call immediately
	 * before dispatching: this is what makes the app say a wallet is thinking.
	 */
	dispatched(): void;
	/**
	 * Whether the user gave up while this was still being prepared.
	 *
	 * Synchronous, unlike {@link abandoned}, because the caller has to decide
	 * whether to dispatch AT ALL, and a promise cannot be consulted in time.
	 */
	wasAbandoned(): boolean;
	/**
	 * The request was never sent, and we know that for certain because we never
	 * asked. Removes the record.
	 *
	 * The one case where dropping a record is not a guess: everywhere else the
	 * app cannot tell a request that failed from one that landed, but it can
	 * always tell one it never made. Keeping it would mean later telling the user
	 * a transaction "may still be waiting in your wallet" when the wallet was
	 * never shown it, which is the same lie as claiming a rejection, pointed the
	 * other way.
	 */
	discard(): void;
	/**
	 * We have a hash: the transaction exists and account data has it.
	 *
	 * A NO-OP when the record has already been marked as an unrecorded broadcast
	 * ({@link InFlightLedger.noteUnrecordedBroadcast}), which happens moments
	 * earlier on the same call stack: the tracker emits `transaction:broadcasted`
	 * before `writeContract` returns, so by the time we get here we may already
	 * know that filing it failed. Dropping the record then would throw away the
	 * only trace of a transaction that is on chain.
	 */
	broadcast(): void;
	/** The wallet said the user rejected it (code 4001). We saw this happen. */
	rejected(): void;
	/** Something else went wrong. We know nothing, so the record stays. */
	leaveUnresolved(): void;
	/**
	 * Rejects with {@link StoppedWaitingError} if the user stops waiting before
	 * this dispatch settles. Never resolves, and never rejects otherwise.
	 *
	 * For the caller to race against its own dispatch, so that giving up releases
	 * the UI without touching the request. The dispatch keeps running and settles
	 * this record whenever the wallet finally answers, which is what makes "we
	 * stopped waiting" different from "nothing happened".
	 */
	abandoned: Promise<never>;
};

export type InFlightLedger = Readable<InFlightState> & {
	/**
	 * Persist a request, then resolve its baseline nonce. CALL BEFORE DISPATCH
	 * and await it: the baseline is the node's next expected nonce for the sender
	 * BEFORE the wallet can broadcast, and reading it afterwards would compare
	 * the request against a chain it may already have changed.
	 *
	 * THIS COSTS A ROUND TRIP ON THE USER'S CLICK, and it is a second one: the tx
	 * tracker resolves the nonce again for itself immediately afterwards
	 * (`TrackedWalletClient`'s `extractTransactionContext`). Accepted, for two
	 * reasons. The tracker does not expose its resolved nonce before dispatch, so
	 * reusing it would mean either patching the library or inferring it, and the
	 * read is a single `eth_getTransactionCount` bounded by `baselineTimeoutMs`
	 * with the record already durable before it starts, so the worst case is a
	 * slower click and a lost comparison rather than a lost transaction.
	 *
	 * Worth knowing that the two reads can disagree: this one prefers the app's
	 * own RPC (see `readNodeNonce`), while the tracker's goes through the wallet's
	 * client. That is deliberate, since `nonce-cache.ts` documents at length that
	 * a wallet's nonce is exactly what cannot be trusted here, but it does mean a
	 * wallet with a stale cached nonce can broadcast at a different nonce than the
	 * baseline recorded. Reconciliation then reports `nonce-free` ("may still be
	 * waiting") for a transaction that was in fact sent, which is wrong but errs
	 * toward doubt rather than toward false reassurance.
	 */
	record(params: {
		account: `0x${string}`;
		intent: InFlightIntent;
		/**
		 * The nonce this transaction will actually use, when the caller knows it
		 * (a resubmit or a replacement always does). Better than the baseline read
		 * below, which is only the nonce the node expects NEXT and is one behind
		 * the truth whenever the wallet already has something queued.
		 */
		nonce?: number;
		/**
		 * Whether answering this request needs a human at a wallet. Defaults to
		 * `true`, so a caller that has not thought about it gets the loud behaviour
		 * rather than a silent one. See {@link InFlightState.prompting}.
		 *
		 * Not persisted: it only decides what to show while the request is live, and
		 * after a reload nothing is being awaited at all.
		 */
		prompts?: boolean;
	}): Promise<InFlightHandle>;
	/**
	 * Work out what happened to every unsettled record.
	 *
	 * Safe to call repeatedly. A call made while a pass is running does NOT
	 * collapse into it: every caller here is reacting to something that changed
	 * (an account arriving, a dismissal), and the running pass was started before
	 * that and cannot know about it. Dropping the later request is how a
	 * reconciliation reports what was true a moment ago. Concurrent calls
	 * therefore share one TRAILING pass rather than being ignored.
	 */
	reconcile(): Promise<void>;
	/**
	 * Release every caller currently awaiting a dispatch: their `abandoned`
	 * promise rejects with {@link StoppedWaitingError}.
	 *
	 * The records are untouched, deliberately. The requests are still with the
	 * wallet and will settle their own records if it ever answers; what this ends
	 * is the app's waiting, not the transactions.
	 *
	 * ALL OF THEM, and yes, `createStoppedWaiting` in `core/connection/wallet-activity.ts`
	 * argues at length that the neighbouring suppression must be per request id
	 * rather than a flag.
	 * These answer different questions. That one decides whether to show a prompt
	 * about a request LATER, where treating a new request as already-dismissed
	 * would silence a send the user never gave up on. This one answers "the user
	 * has stopped waiting for their wallet", which is a statement about the
	 * wallet, not about one request in it: the modal they clicked says "confirm
	 * the request in your wallet" without naming one, and someone with two sends
	 * outstanding who gives up has given up on both.
	 *
	 * It could not be scoped anyway without inventing a mapping that does not
	 * exist: prompt suppression is keyed by the PROVIDER's request ids, ledger
	 * records by ids of our own, and nothing relates them. Note the consequence,
	 * which is real if narrow: two concurrent sends and one escape-hatch click
	 * releases both callers. Both records survive and still settle themselves, so
	 * what the second caller loses is its await, not its transaction.
	 */
	stopAwaiting(): void;
	/**
	 * A transaction was broadcast, we have the hash, and it could NOT be filed as
	 * an operation. Attach that to the matching record so the user is told what
	 * actually happened rather than being left with a guess.
	 *
	 * Matched by account and nonce, which is what identifies a request before it
	 * has a hash. A record whose baseline was never read (`nonce: undefined`) is
	 * matched as a last resort by being the oldest unsettled one for that account,
	 * because "we know one of these was sent" beats saying nothing.
	 */
	noteUnrecordedBroadcast(params: {
		account: `0x${string}`;
		nonce: number | undefined;
		hash: `0x${string}`;
	}): void;
	/** The user has read the verdict on this record. Forget it. */
	acknowledge(id: string): void;
	/** Forget every record that has been reconciled. */
	acknowledgeAll(): void;
};

export type InFlightLedgerParams = {
	storage: InFlightStorage;
	/** Records are per chain: the key, and the `chainId` written on each record. */
	chainId: number;
	/**
	 * The chain's genesis hash, which scopes the key alongside the id.
	 *
	 * A chain id is NOT identity: restart a local node and it comes back as the
	 * same id with a different history, which is the whole premise of
	 * `nonce-cache.ts`. Records written against the old chain would then be
	 * reconciled against the new one, comparing nonces across histories.
	 * `AccountData`'s own storage key has always included this; in-flight records
	 * are reconciled BY NONCE, so they need it at least as much.
	 */
	genesisHash?: string;
	now: () => number;
	/**
	 * The node's `pending` transaction count for an address, from the most
	 * trusted source available. Prefer the app's own RPC over the wallet's, for
	 * the reason `nonce-cache.ts` documents at length: a wallet with a stale
	 * cached nonce is exactly the situation where its answer cannot be believed.
	 */
	readNodeNonce: (address: `0x${string}`) => Promise<number | undefined>;
	/**
	 * Nonces the app has already recorded for an address, or `undefined` when it
	 * cannot know (account data belongs to one account at a time and is restored
	 * asynchronously). Resolving, so the caller can wait for that restore instead
	 * of answering "none" while it is still happening.
	 */
	recordedNonces: (
		address: `0x${string}`,
	) => Promise<readonly number[] | undefined>;
	/**
	 * How long to wait for the baseline nonce before dispatching anyway.
	 *
	 * A budget, not a correctness knob. Losing the baseline costs us the nonce
	 * comparison later; blocking the user's transaction on a slow RPC costs them
	 * the transaction, and they would reasonably click again.
	 */
	baselineTimeoutMs?: number;
	/**
	 * How long a RECONCILIATION read may take before it counts as unreadable.
	 *
	 * Not the same budget as `baselineTimeoutMs`, and deliberately looser: that
	 * one is a user waiting to send, this one is background work with nothing on
	 * screen behind it, so it can afford to be patient with a slow node. What it
	 * must not do is wait for EVER, which is what an unbounded read does.
	 *
	 * Giving up is a real answer here (`unreadable`), and a watchable one, so the
	 * backoff watcher tries again rather than the app being stuck.
	 */
	readTimeoutMs?: number;
};

const DEFAULT_BASELINE_TIMEOUT_MS = 4000;
const DEFAULT_READ_TIMEOUT_MS = 15_000;

function storageKey(chainId: number, genesisHash: string | undefined): string {
	return genesisHash
		? `__in_flight_requests__${chainId}_${genesisHash}`
		: `__in_flight_requests__${chainId}`;
}

/**
 * How long a record can sit unresolved before it is dropped on load.
 *
 * Nothing else bounds the list: a record survives until the user acknowledges
 * it, and one they never saw (because they did not open the app again for a
 * fortnight) would otherwise live for ever. It is also the point past which the
 * nonce comparison stops meaning anything, since the account will have sent
 * plenty since, so keeping the record buys no better answer than dropping it.
 */
const RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve `value`, or `undefined` if it takes longer than `ms`.
 *
 * The pending promise is left to settle on its own: nothing downstream is
 * waiting on it, and rejecting it here would surface as an unhandled rejection
 * for a read whose failure we have already decided to tolerate.
 */
function withDeadline<T>(
	value: Promise<T>,
	ms: number,
): Promise<T | undefined> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(undefined), ms);
		value.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			() => {
				clearTimeout(timer);
				resolve(undefined);
			},
		);
	});
}

export function createInFlightLedger(
	params: InFlightLedgerParams,
): InFlightLedger {
	const {
		storage,
		chainId,
		genesisHash,
		now,
		readNodeNonce,
		recordedNonces,
		baselineTimeoutMs = DEFAULT_BASELINE_TIMEOUT_MS,
		readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
	} = params;

	const key = storageKey(chainId, genesisHash);

	/**
	 * Live dispatches, by record id, so `stopAwaiting` can release them and
	 * `commit` can report how many there are.
	 *
	 * Declared here, above everything that closes over it, because `commit` reads
	 * `awaiting.size` on every write and a reader should not have to prove to
	 * themselves that the temporal dead zone is never hit.
	 */
	const awaiting = new Map<string, (reason: unknown) => void>();

	/**
	 * Records the wallet has ACTUALLY been asked about, and has not answered.
	 *
	 * Deliberately a different set from `awaiting`, which starts one baseline-read
	 * earlier. This one is what the app shows a modal about.
	 */
	const dispatchedIds = new Set<string>();

	/**
	 * The subset of {@link dispatchedIds} that a human has to answer.
	 *
	 * A second set rather than a filter over the records, because the records are
	 * persisted and this is a fact about the live request only. Kept in step with
	 * `dispatchedIds` by the same three lines (`dispatched`, `settle`,
	 * `stopAwaiting`), so it can never outlive the dispatch it describes.
	 */
	const promptingIds = new Set<string>();

	function readStored(): InFlightRequest[] {
		try {
			const raw = storage.getItem(key);
			if (!raw) return [];
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			// Anything unrecognisable is dropped rather than reconciled against;
			// see isInFlightRequest for why that is safe here specifically. Anything
			// stale goes with it: see RECORD_RETENTION_MS.
			const cutoff = now() - RECORD_RETENTION_MS;
			return parsed
				.filter(isInFlightRequest)
				.filter((request) => request.requestedAt > cutoff);
		} catch {
			return [];
		}
	}

	function writeStored(requests: readonly InFlightRequest[]): void {
		try {
			if (requests.length === 0) storage.removeItem(key);
			else storage.setItem(key, JSON.stringify(requests));
		} catch {
			// A storage that refuses to write (private mode, quota) costs us the
			// durability, not the send. There is nothing better to do here, and
			// throwing would turn a degraded safety net into a broken app.
		}
	}

	// Restored, not empty: records outlive the tab that wrote them, and the whole
	// point is that a reload finds them.
	let current: InFlightState = {
		requests: readStored(),
		outcomes: {},
		dispatching: 0,
		prompting: 0,
	};
	const state = writable<InFlightState>(current);

	function commit(next: Omit<InFlightState, 'dispatching' | 'prompting'>) {
		// Always recomputed rather than passed in, so it cannot drift from the maps
		// that actually hold the live dispatches.
		current = {
			...next,
			dispatching: dispatchedIds.size,
			prompting: promptingIds.size,
		};
		writeStored(current.requests);
		state.set(current);
	}

	/** Republish when only the live-dispatch count has changed. */
	function commitDispatching() {
		commit({requests: current.requests, outcomes: current.outcomes});
	}

	function remove(id: string) {
		const outcomes = {...current.outcomes};
		delete outcomes[id];
		commit({
			requests: current.requests.filter((request) => request.id !== id),
			outcomes,
		});
	}

	async function record(recordParams: {
		account: `0x${string}`;
		intent: InFlightIntent;
		nonce?: number;
		prompts?: boolean;
	}): Promise<InFlightHandle> {
		const {account, intent, nonce: knownNonce, prompts = true} = recordParams;
		const id = randomId();

		// PERSISTED FIRST, with no nonce. Everything after this line may never
		// happen: the tab can be closed, the process killed, the RPC can hang. What
		// must survive all of it is the fact that we were about to ask a wallet to
		// send something, and for whom.
		const request: InFlightRequest = {
			id,
			account,
			chainId,
			nonce: knownNonce,
			intent,
			requestedAt: now(),
		};

		// Registered as live BEFORE the commit that publishes the record, because
		// `commit` derives `dispatching` from this map. Doing it after would publish
		// a state saying a transaction exists and nothing is being waited on, which
		// is the exact instant the wallet modal decides whether to appear.
		//
		// `abandoned` is rejected only by stopAwaiting(). The no-op catch keeps that
		// rejection from being reported as unhandled in the ordinary case where the
		// dispatch has already settled and nothing is racing it any more; the
		// caller's own handler still sees it.
		let reject: (reason: unknown) => void = () => {};
		const abandoned = new Promise<never>((_, rejectIt) => {
			reject = rejectIt;
		});
		abandoned.catch(() => {});
		let abandonedFlag = false;
		awaiting.set(id, (reason) => {
			abandonedFlag = true;
			reject(reason);
		});

		commit({
			requests: [...current.requests, request],
			outcomes: current.outcomes,
		});

		const settle = (then: () => void) => {
			const wasAwaited = awaiting.delete(id);
			const wasDispatched = dispatchedIds.delete(id);
			promptingIds.delete(id);
			then();
			// `leaveUnresolved` changes nothing else, so without this the count would
			// stay high and the app would keep claiming a wallet was still thinking.
			if (wasAwaited || wasDispatched) commitDispatching();
		};

		const nonce =
			knownNonce ??
			(await withDeadline(readNodeNonce(account), baselineTimeoutMs));

		if (knownNonce === undefined && nonce !== undefined) {
			// The record may already be gone (a very fast broadcast, or the user
			// acknowledged it) in which case there is nothing to improve.
			const index = current.requests.findIndex((r) => r.id === id);
			if (index >= 0) {
				const requests = [...current.requests];
				requests[index] = {...requests[index], nonce};
				commit({requests, outcomes: current.outcomes});
			}
		}

		return {
			id,
			abandoned,
			wasAbandoned: () => abandonedFlag,
			dispatched: () => {
				if (abandonedFlag) return;
				dispatchedIds.add(id);
				if (prompts) promptingIds.add(id);
				commitDispatching();
			},
			discard: () => settle(() => remove(id)),
			broadcast: () =>
				settle(() => {
					// See the doc on InFlightHandle.broadcast: filing may already have
					// failed on this same call stack, and that verdict outranks ours.
					if (current.outcomes[id]?.status === 'broadcast-not-recorded') return;
					remove(id);
				}),
			rejected: () => settle(() => remove(id)),
			leaveUnresolved: () => settle(() => {}),
		};
	}

	function stopAwaiting() {
		const releasing = [...awaiting.values()];
		awaiting.clear();
		dispatchedIds.clear();
		promptingIds.clear();
		commitDispatching();
		for (const abandon of releasing) abandon(new StoppedWaitingError());
	}

	function noteUnrecordedBroadcast(params: {
		account: `0x${string}`;
		nonce: number | undefined;
		hash: `0x${string}`;
	}) {
		const {account, nonce, hash} = params;
		const sameAccount = current.requests.filter(
			(request) =>
				request.account.toLowerCase() === account.toLowerCase() &&
				!current.outcomes[request.id],
		);
		const match =
			(nonce !== undefined
				? sameAccount.find((request) => request.nonce === nonce)
				: undefined) ??
			sameAccount.find((request) => request.nonce === undefined) ??
			sameAccount[0];

		if (!match) {
			// Nothing to attach it to (a send that predates the ledger, or one
			// already settled). Losing the hash silently is the one outcome worth
			// refusing, so it goes somewhere a developer will see it.
			console.error(
				`[in-flight] transaction ${hash} from ${account} was broadcast but ` +
					`could not be recorded, and no in-flight record matches it. It is ` +
					`on chain and the app has no note of it.`,
			);
			return;
		}

		commit({
			requests: current.requests,
			outcomes: {
				...current.outcomes,
				[match.id]: {
					status: 'broadcast-not-recorded',
					hash,
					...(nonce !== undefined ? {nonce} : {}),
				},
			},
		});
	}

	let reconciling: Promise<void> | undefined;
	/** A pass asked for while one was running, and therefore still owed. */
	let reconcileAgain: Promise<void> | undefined;

	async function reconcileOnce(): Promise<void> {
		const pending = current.requests;
		if (pending.length === 0) return;

		// One read per distinct account, not per record: a user who fired two
		// requests before reloading has two records and one nonce to compare them
		// against.
		const accounts = [...new Set(pending.map((request) => request.account))];
		// BOUNDED, exactly as the baseline read on the dispatch path is.
		//
		// `.catch()` alone is not enough and the difference is the whole bug: a
		// rejected read gives `undefined` and the pass finishes, but a read that
		// simply never SETTLES leaves this `await` outstanding for ever. Then
		// `reconcile()` never resolves, no outcome is ever written, and the notice
		// that exists to tell a user their transaction may be in the mempool is
		// silently never shown. Nothing throws and nothing logs.
		//
		// `readNodeNonce` is exactly that shape by default: a bare `fetch` with no
		// signal (core/connection/nonce-cache). Found by e2e, where eight parallel
		// browsers against one node stalled it past twenty seconds; the same stall
		// in production is a flaky RPC, which is the case this whole ledger exists
		// for. A DESCENDANT's reader is bounded here too, whatever it does.
		//
		// Giving up reads `undefined`, which reconciles to the `unreadable`
		// outcome: watchable, so the backoff watcher asks again and the app heals
		// itself. That is the designed behaviour, and it was unreachable.
		const readings = await Promise.all(
			accounts.map(async (account) => ({
				account,
				nodeNonce: await withDeadline(readNodeNonce(account), readTimeoutMs),
				recorded: await withDeadline(recordedNonces(account), readTimeoutMs),
			})),
		);
		const byAccount = new Map(readings.map((r) => [r.account, r]));

		const outcomes = {...current.outcomes};
		const kept: InFlightRequest[] = [];

		for (const request of current.requests) {
			// A record added while we were reading has not been dispatched long
			// enough to have an answer; leave it alone rather than reconcile a
			// request that is genuinely still in flight.
			if (!pending.includes(request)) {
				kept.push(request);
				continue;
			}
			// Something we WATCHED happen outranks anything a nonce comparison can
			// work out, and it is the only outcome carrying a hash.
			const observed = current.outcomes[request.id];
			if (observed?.status === 'broadcast-not-recorded') {
				kept.push(request);
				continue;
			}
			const reading = byAccount.get(request.account);
			const outcome = reconcileRequest({
				request,
				nodeNonce: reading?.nodeNonce,
				recordedNonces: reading?.recorded,
			});
			if (outcome.status === 'recorded') {
				// The app has the transaction. Nothing to say, nothing to keep.
				delete outcomes[request.id];
				continue;
			}
			outcomes[request.id] = outcome;
			kept.push(request);
		}

		commit({requests: kept, outcomes});
	}

	function reconcile(): Promise<void> {
		if (!reconciling) {
			reconciling = reconcileOnce().finally(() => {
				reconciling = undefined;
			});
			return reconciling;
		}
		// A pass is already running, and it started before whatever prompted this
		// call. One more pass afterwards settles everyone; several callers arriving
		// during the same pass share it.
		if (!reconcileAgain) {
			reconcileAgain = reconciling
				.catch(() => {})
				.then(() => {
					reconcileAgain = undefined;
					return reconcile();
				});
		}
		return reconcileAgain;
	}

	return {
		subscribe: state.subscribe,
		record,
		reconcile,
		stopAwaiting,
		noteUnrecordedBroadcast,
		acknowledge: remove,
		acknowledgeAll() {
			const reconciled = new Set(Object.keys(current.outcomes));
			commit({
				requests: current.requests.filter(
					(request) => !reconciled.has(request.id),
				),
				outcomes: {},
			});
		},
	};
}
