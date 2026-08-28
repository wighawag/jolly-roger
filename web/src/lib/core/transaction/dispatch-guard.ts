import {isUserRejectionError} from './user-rejection';
import {StoppedWaitingError} from './StoppedWaitingError';
import type {InFlightIntent} from './in-flight';
import type {InFlightLedger} from './in-flight-store';

/**
 * Record every transaction request BEFORE it is dispatched (ADR-0004, `work`).
 *
 * WHY A WRAPPER AND NOT A CALL EACH SITE MAKES. There are four dispatch sites in
 * this app today and an app built on this template will have more; a rule that
 * every one of them must remember to record first is the same shape as the four
 * hand-written `showMenu = false` lines ADR-0004 deleted, one forgotten call
 * away from losing a transaction. Wrapping the client makes the safe behaviour
 * the only behaviour, and the failure mode of forgetting becomes impossible
 * rather than silent.
 *
 * WHAT IT DOES. Around each sending method: persist a record, dispatch, then
 * settle the record by what was actually observed.
 * - a hash came back: the transaction exists, `account/connectors.ts` has
 *   already recorded the operation, so the record is dropped.
 * - the wallet reported a user rejection (code 4001): we SAW the rejection, so
 *   the record is dropped.
 * - anything else: we know nothing. The record STAYS, to be reconciled by nonce.
 *   An RPC that times out, a wallet that disconnects mid-request and a request
 *   that was broadcast and then lost look identical from here, and only one of
 *   the three means the transaction did not happen.
 * - nothing came back at all (reload, tab close, crash): the record stays,
 *   because it was written to storage before any of this began.
 *
 * IDENTITY IS PRESERVED. The wrapper delegates to the same client object, so
 * `on`/`off` still reach the one emitter the tx-tracking connectors listen to,
 * which `executor.ts` explains is load-bearing. It is also memoised per client,
 * so guarding the same client twice yields the same wrapper and never a second
 * object that nobody listens to.
 */

/** The sending surface we wrap. Stated structurally so both tracked client
 * shapes (auto-populate or not) satisfy it without naming their generics. */
type SendingClient = {
	walletClient?: {account?: {address?: `0x${string}`} | null} | null;
	writeContract(args: never): Promise<unknown>;
	sendTransaction(args: never): Promise<unknown>;
	sendRawTransaction(args: never): Promise<unknown>;
	writeContractSync(args: never): Promise<unknown>;
	sendTransactionSync(args: never): Promise<unknown>;
	sendRawTransactionSync(args: never): Promise<unknown>;
};

/** Loose view of the arguments, since we only read a handful of fields. */
type SendArgs = {
	account?: unknown;
	to?: unknown;
	address?: unknown;
	functionName?: unknown;
	data?: unknown;
	nonce?: unknown;
	metadata?: {type?: unknown; name?: unknown; functionName?: unknown};
};

/**
 * One wrapper per client, keyed by the client alone and NOT by the ledger.
 *
 * A client belongs to one ledger: they are built together, and the point of the
 * memo is that transaction tracking identifies clients by reference, so a second
 * wrapper would be a client nobody listens to (see executor.ts). Keying by the
 * pair would produce exactly that second wrapper instead of catching the
 * mistake, so a mismatched ledger is reported rather than accommodated.
 */
const guarded = new WeakMap<
	object,
	{ledger: InFlightLedger; prompts: boolean; wrapper: unknown}
>();
const GUARD_BRAND = Symbol.for('jolly-roger.dispatch-guard');
/**
 * The wrapper's own answer to "do sends through this need a human".
 *
 * On the WRAPPER rather than only in the memo above, because the memo is keyed
 * by the raw client and a caller holding the wrapper (the likelier mistake once
 * an app has two guarded clients) never reaches it. Without this, guarding a
 * wrapper again with the opposite setting returned the first answer in silence.
 */
const GUARD_PROMPTS = Symbol.for('jolly-roger.dispatch-guard.prompts');

/** Whether this client records requests before dispatching them. */
export function isDispatchGuarded(client: unknown): boolean {
	return (
		!!client &&
		typeof client === 'object' &&
		(client as Record<symbol, unknown>)[GUARD_BRAND] === true
	);
}

/**
 * The address that will sign, from the call arguments or the client itself.
 *
 * viem accepts an address string or an Account object, and falls back to the
 * client's own account. Returning `undefined` rather than guessing matters: a
 * record filed against the wrong account reconciles against the wrong nonce and
 * would report on a transaction that never existed.
 */
export function resolveSender(
	args: SendArgs,
	client: SendingClient,
): `0x${string}` | undefined {
	const account = args.account;
	if (typeof account === 'string' && account.startsWith('0x')) {
		return account as `0x${string}`;
	}
	if (account && typeof account === 'object') {
		const address = (account as {address?: unknown}).address;
		if (typeof address === 'string') return address as `0x${string}`;
	}
	return client.walletClient?.account?.address ?? undefined;
}

/**
 * Name the request the way the transaction list will name it once it exists.
 *
 * Same rule as `view/operation.ts`'s `getOperationName`, deliberately: a user
 * comparing "we are not sure this was sent" against their transaction list is
 * matching two strings, and they should be the same string.
 */
export function describeRequest(
	args: SendArgs,
	fallback: string,
): InFlightIntent {
	const metadata = args.metadata;
	const functionName =
		typeof args.functionName === 'string'
			? args.functionName
			: typeof metadata?.functionName === 'string'
				? metadata.functionName
				: undefined;

	const name =
		metadata?.type === 'unknown' && typeof metadata.name === 'string'
			? metadata.name
			: (functionName ?? fallback);

	const target = args.address ?? args.to;

	return {
		description: name,
		...(typeof target === 'string' ? {to: target as `0x${string}`} : {}),
		...(functionName ? {functionName} : {}),
	};
}

/**
 * Whether answering a send through this client needs A HUMAN AT A WALLET.
 *
 * ASKED HERE BECAUSE THIS IS WHERE IT IS KNOWN. Whether a transaction prompts
 * anyone is a property of WHO SIGNS, and the only place that knows who signs is
 * the place that builds the client. Every consumer downstream sees a count, and
 * a count cannot tell a wallet apart from a key the app holds itself.
 *
 * It used to be inferred: "a dispatch is outstanding" was read as "a human must
 * act", which is true only while there is exactly one sender and that sender is
 * a wallet. Add a second guarded client for a local signer and every silent
 * transaction raises a modal titled "Wallet Action Required" with no wallet
 * involved and nobody waiting on the user.
 *
 * Defaults to `true`, so every existing call site keeps prompting exactly as it
 * did, and only a client that KNOWS it is silent says so.
 */
export type DispatchGuardOptions = {
	/**
	 * `false` for a signer the app holds the key for: it sends with no dialog,
	 * nothing is waiting on the user, and telling them to check their wallet
	 * would be a lie. It still records, still counts toward `dispatching`, and
	 * still arms the unload guard, because a silent transaction in flight is
	 * every bit as losable as a loud one.
	 */
	prompts?: boolean;
};

export function guardDispatch<Client extends SendingClient>(
	client: Client,
	ledger: InFlightLedger,
	options?: DispatchGuardOptions,
): Client {
	const prompts = options?.prompts ?? true;

	/**
	 * Reported on BOTH already-guarded paths (a wrapper handed back in, and a raw
	 * client guarded twice), because the answer is a property of the key that
	 * signs and the second caller is simply wrong about it. Silence here means the
	 * modal follows whichever call happened to run first, which is the least
	 * debuggable version of this bug.
	 */
	function warnIfPromptsDiffer(guardedPrompts: boolean): void {
		if (!import.meta.env.DEV || guardedPrompts === prompts) return;
		console.warn(
			'[dispatch-guard] this client is already guarded with a different ' +
				'`prompts` setting. The first one wins, so one of the two callers is ' +
				'wrong about whether sends through this client need a human at a ' +
				'wallet, and the "Wallet Action Required" modal will follow the other ' +
				'one. A client signs with one key: guard it once, where it is built.',
		);
	}

	if (isDispatchGuarded(client)) {
		warnIfPromptsDiffer(
			(client as Record<symbol, unknown>)[GUARD_PROMPTS] !== false,
		);
		return client;
	}
	const existing = guarded.get(client);
	if (existing) {
		warnIfPromptsDiffer(existing.prompts);
		// The same hole exists for the ledger below, which cannot be closed the same
		// way: a wrapper carrying a reference to its ledger would keep it alive for
		// as long as anything holds the client. Left as it was, deliberately.
		if (import.meta.env.DEV && existing.ledger !== ledger) {
			console.warn(
				'[dispatch-guard] this client is already guarded by a different ' +
					'in-flight ledger. The first one wins, because two wrappers for one ' +
					'client would mean one of them is a client nothing listens to, and ' +
					'its transactions would silently stop being recorded. Build the ' +
					'client and the ledger together instead.',
			);
		}
		return existing.wrapper as Client;
	}

	async function run<Result>(
		args: SendArgs,
		fallbackName: string,
		dispatch: () => Promise<Result>,
	): Promise<Result> {
		const account = resolveSender(args, client);
		if (!account) {
			// No sender means no nonce to reconcile against, so a record would be a
			// note we could never resolve. viem is about to fail for the same reason.
			return dispatch();
		}

		const handle = await ledger.record({
			account,
			intent: describeRequest(args, fallbackName),
			// Carried per record rather than read off the client later, because what
			// the app must decide is about THIS request: which dispatches justify
			// telling the user to go and look at their wallet.
			prompts,
			// An explicit nonce is better than the baseline the ledger would read:
			// it is the nonce this transaction WILL use, rather than the one the
			// node happens to expect next. Resubmits and replacements always carry
			// one (see ui/pending-operation/operation-actions.ts).
			nonce: typeof args.nonce === 'number' ? args.nonce : undefined,
		});

		// NEVER ASK THE WALLET FOR SOMETHING THE USER HAS ALREADY DROPPED.
		//
		// `record()` above persists and then reads a baseline nonce, which can take
		// seconds. A user on a waiting modal can stop waiting inside that window,
		// and dispatching afterwards would pop their wallet for a request they had
		// just abandoned, then immediately throw. The record goes too, and this is
		// the one place that may drop one without guessing: we know it was never
		// sent, because we never asked.
		if (handle.wasAbandoned()) {
			handle.discard();
			throw new StoppedWaitingError();
		}

		// From here the wallet really is being asked, which is what the app shows a
		// "confirm in your wallet" modal about.
		handle.dispatched();

		// TWO PROMISES, ON PURPOSE, and keeping them apart is what lets a user walk
		// away from a wallet that never answers.
		//
		// `settled` follows the REQUEST, all the way to whatever the wallet
		// eventually says, and files the outcome. It is never cancelled: a user who
		// approves ten minutes later still gets their transaction recorded, which is
		// exactly what the escape hatch promises them.
		//
		// What is returned follows the CALLER, and ends as soon as either the
		// request settles or the user stops waiting. Without this, releasing the
		// user released the modal and left the page that started the send blocked on
		// a promise nothing was going to settle, so the Send button spun for ever.
		// A wallet is under no obligation to answer a request the user dismissed,
		// so no amount of waiting fixes that.
		const dispatched = dispatch();
		const settled = dispatched.then(
			(result) => {
				handle.broadcast();
				return result;
			},
			(error) => {
				if (isUserRejectionError(error)) handle.rejected();
				else handle.leaveUnresolved();
				throw error;
			},
		);

		// `race` registers a handler on `settled`, so a rejection arriving after the
		// caller has been released is still handled and never surfaces as an
		// unhandled rejection.
		return Promise.race([settled, handle.abandoned]);
	}

	const wrapper = {
		...client,
		[GUARD_BRAND]: true,
		[GUARD_PROMPTS]: prompts,

		writeContract: ((args: SendArgs) =>
			run(args, 'Contract call', () =>
				client.writeContract(args as never),
			)) as Client['writeContract'],

		sendTransaction: ((args: SendArgs) =>
			run(args, 'Transaction', () =>
				client.sendTransaction(args as never),
			)) as Client['sendTransaction'],

		sendRawTransaction: ((args: SendArgs) =>
			run(args, 'Transaction', () =>
				client.sendRawTransaction(args as never),
			)) as Client['sendRawTransaction'],

		writeContractSync: ((args: SendArgs) =>
			run(args, 'Contract call', () =>
				client.writeContractSync(args as never),
			)) as Client['writeContractSync'],

		sendTransactionSync: ((args: SendArgs) =>
			run(args, 'Transaction', () =>
				client.sendTransactionSync(args as never),
			)) as Client['sendTransactionSync'],

		sendRawTransactionSync: ((args: SendArgs) =>
			run(args, 'Transaction', () =>
				client.sendRawTransactionSync(args as never),
			)) as Client['sendRawTransactionSync'],
	} as Client;

	guarded.set(client, {ledger, prompts, wrapper});
	return wrapper;
}
