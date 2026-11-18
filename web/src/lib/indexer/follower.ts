/**
 * FOLLOW AN INDEXED STATE, re-reading only what moved (etherfold ADR-0083).
 *
 * A game's indexed state is a set of PARTS, each one GraphQL question over the
 * entities its processor declares (cells, owners, a commitment, ...). The
 * game says which parts there are, which part each entity's move invalidates,
 * and how to read some parts as of one block (`read`); this module does the
 * rest, which every indexed game would otherwise write again:
 *
 * - one full read, then per state-moved signal (`moved`):
 * - a coherence token it does not hold (a reorg, a promotion, the first
 *   signal): read everything again;
 * - an `applied` block: read only the parts whose entities the signal names,
 *   AS OF the signal's block (or the block the state is at, when that is
 *   later), pinned by its HASH, so the re-read is of that block on ONE chain.
 *
 * Why that composes into the state of ONE block: a part the signals did not
 * name since it was read did not change since, so it is still right as of the
 * newer block; and every part that did is read as of that block. Pinning to a
 * block the fold has just applied is also what keeps the read cheap on
 * IndexedDB, whose as-of read costs the versions closed ABOVE that block.
 *
 * Why by hash and not by number: a reorg can replace the block between the
 * signal and the re-read. Pinned to its number, the re-read would read the
 * REPLACEMENT and compose it with parts read on the old chain. Pinned to its
 * hash, it is refused (`block-not-recorded`), and the follower reads everything
 * again, at the tip, without telling anyone: a replaced block is the chain
 * moving, not a failure.
 *
 * Work is serialised: one read at a time, the moves that arrive meanwhile
 * merged into the next one, so an older answer can never land after a newer
 * one. Any other failure is reported (`onError`) and the next read is a full
 * one.
 *
 * ONE PART MAY DEPEND ON WHO PLAYS (`accountPart`): a game that reads only the
 * connected player's commitment re-reads that part when the player changes.
 *
 * Written first in stratagems (its `indexer/src/queries.ts`, step X1 of its
 * plan), where it ran its board on alpha1 and in the offline world.
 */

/** What a GraphQL executor answers (`QueryResult` in `@etherfold/graphql`), as far as a reader reads it. */
export type QueryAnswer = {
	readonly data?: unknown;
	readonly errors?: readonly {
		readonly message: string;
		readonly extensions?: {readonly code?: unknown};
	}[];
	readonly extensions?: {
		readonly block?: number | null;
		readonly blockHash?: string | null;
		readonly generation?: string;
	};
};

/** Any executor: `workerExecutor(port)`, `httpExecutor(url)`, `localExecutor(schema, context)`. */
export type Execute = (request: {
	readonly query: string;
	readonly variables?: Readonly<Record<string, unknown>>;
}) => Promise<QueryAnswer>;

/** A recorded block: its number, and the hash that names it on ONE chain. */
export type BlockRef = {readonly number: number; readonly hash: string};

/**
 * The code a read pinned to a hash is refused with when the store has no record
 * of that hash: the block was replaced by a reorg (etherfold ADR-0015,
 * ADR-0099). A `read` reports it as an error carrying this `code`.
 */
export const BLOCK_NOT_RECORDED = 'block-not-recorded';

/** A refused or failed query, carrying the code the executor gave (`rows-examined-bound`, `transport-failure`, ...). */
export class StateQueryError extends Error {
	constructor(
		message: string,
		readonly code: string | undefined,
	) {
		super(message);
		this.name = 'StateQueryError';
	}
}

/** Some parts of a state, all as of one block. */
export type StateRead<Data> = {
	readonly data: Data;
	/** The one block every field was read as of (undefined before the first block). */
	readonly block?: number;
	/** That block's hash (`extensions.blockHash`, or the hash the read was pinned to). */
	readonly blockHash?: string;
	/** The generation that answered. */
	readonly generation?: string;
};

/** What the state-moved signal says (etherfold's `StateMoved`), as far as the follower reads it. */
export type Moved =
	| {
			readonly kind: 'applied';
			readonly block: number;
			readonly hash: string;
			readonly coherence: string;
			readonly entities: readonly string[];
	  }
	| {readonly kind: 'retracted' | 'repointed'; readonly coherence: string};

/**
 * The game's half: its parts and how to read them.
 *
 * `read` asks the given parts as of `at` (a number, a `BlockRef`, or the tip
 * when left out), writes them into a copy of `into` (a fresh state when left
 * out), and throws an error with `code: 'block-not-recorded'` when a pinned
 * hash is unknown. `account` is who plays, for the part that depends on it.
 */
export type StateFollowerSpec<Part extends string, Data> = {
	readonly parts: readonly Part[];
	/** Which part an entity's move invalidates; an entity left out invalidates every part. */
	readonly partOf: Readonly<Record<string, Part>>;
	/** The part that depends on who plays, re-read when the player changes. */
	readonly accountPart?: Part;
	readonly read: (
		execute: Execute,
		parts: ReadonlySet<Part>,
		options: {account: string; at?: number | BlockRef; into?: Data},
	) => Promise<StateRead<Data>>;
};

export type StateFollower<Data> = {
	/** The last state read, with the block it is as of. */
	readonly state: StateRead<Data> | undefined;
	onUpdate(listener: (read: StateRead<Data>) => void): () => void;
	/** Read everything again (the first read, or a reset). */
	refreshAll(): Promise<void>;
	/** Feed it every state-moved signal, in order. */
	moved(moved: Moved): Promise<void>;
	/** Who plays changed: the account part is re-read. */
	setAccount(account: string): Promise<void>;
};

/** The parts the given entities' moves invalidate; an entity the spec does not know invalidates everything. */
export function partsMovedBy<Part extends string>(
	spec: Pick<StateFollowerSpec<Part, unknown>, 'parts' | 'partOf'>,
	entities: readonly string[],
): Set<Part> {
	const parts = new Set<Part>();
	for (const entity of entities) {
		const part = spec.partOf[entity];
		if (!part) return new Set(spec.parts);
		parts.add(part);
	}
	return parts;
}

function codeOf(error: unknown): string | undefined {
	const code = (error as {code?: unknown} | undefined)?.code;
	return typeof code === 'string' ? code : undefined;
}

export function createStateFollower<Part extends string, Data>(
	spec: StateFollowerSpec<Part, Data>,
	execute: Execute,
	options: {
		account?: string;
		onError?: (error: StateQueryError) => void;
	} = {},
): StateFollower<Data> {
	let account = options.account ?? '';
	const onError = options.onError ?? (() => {});
	let current: StateRead<Data> | undefined;
	let coherence: string | undefined;
	let everything = true;
	let dirty = new Set<Part>();
	/** The latest block an `applied` signal named since the last read. */
	let dirtyAt: BlockRef | undefined;
	let running: Promise<void> | undefined;
	const listeners = new Set<(read: StateRead<Data>) => void>();

	/**
	 * The block a partial read is pinned to: the latest one a signal named, or
	 * the block the state is at when that is later (or when no signal named one:
	 * an account change). By hash when it is known; by number only for a state
	 * read before a host named hashes; the tip when the state is at no block yet.
	 */
	function pin(
		signalled: BlockRef | undefined,
		held: StateRead<Data>,
	): number | BlockRef | undefined {
		const at =
			held.block === undefined
				? undefined
				: held.blockHash !== undefined
					? {number: held.block, hash: held.blockHash}
					: held.block;
		if (!signalled) return at;
		if (at === undefined) return signalled;
		const heldNumber = typeof at === 'number' ? at : at.number;
		return heldNumber > signalled.number ? at : signalled;
	}

	async function drain(): Promise<void> {
		while (everything || dirty.size > 0) {
			const all = everything || !current;
			const parts = all ? new Set(spec.parts) : dirty;
			const at = all ? undefined : pin(dirtyAt, current!);
			everything = false;
			dirty = new Set();
			dirtyAt = undefined;
			try {
				current = await spec.read(execute, parts, {
					account,
					at,
					into: all ? undefined : current!.data,
				});
			} catch (error) {
				if (codeOf(error) === BLOCK_NOT_RECORDED) {
					// the block this read was pinned to was replaced: read it all again, at the tip
					everything = true;
					continue;
				}
				// read it all again next time: a part that failed is not known to be right
				everything = true;
				onError(
					error instanceof StateQueryError
						? error
						: new StateQueryError(
								error instanceof Error ? error.message : String(error),
								codeOf(error),
							),
				);
				return;
			}
			for (const listener of listeners) listener(current);
		}
	}

	function schedule(): Promise<void> {
		if (!running) {
			running = drain().finally(() => (running = undefined));
		}
		return running;
	}

	return {
		get state() {
			return current;
		},
		onUpdate(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		refreshAll() {
			everything = true;
			return schedule();
		},
		moved(moved) {
			if (moved.coherence !== coherence) {
				coherence = moved.coherence;
				everything = true;
			} else if (moved.kind === 'applied') {
				for (const part of partsMovedBy(spec, moved.entities)) dirty.add(part);
				if (!dirtyAt || moved.block >= dirtyAt.number) {
					dirtyAt = {number: moved.block, hash: moved.hash};
				}
			} else {
				everything = true;
			}
			return schedule();
		},
		setAccount(next) {
			if (next.toLowerCase() === account.toLowerCase())
				return Promise.resolve();
			account = next;
			if (!spec.accountPart) return Promise.resolve();
			dirty.add(spec.accountPart);
			return schedule();
		},
	};
}
