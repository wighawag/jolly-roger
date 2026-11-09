import type {Endpoint} from 'comlink';
import {createIndexedDBPersistence, type SlimNode} from 'webevm';
import {createWorkerNode} from 'webevm/worker-client';
import type {StartEmbeddedNodeParams} from '$lib/embedded/node';
import type {OfflineNodeOptions} from './offline-node-host.js';

/**
 * WHERE THE OFFLINE WORLD'S NODE RUNS: in a Worker whenever there is one, so
 * that interpreting a commit, a 1.3M-gas reveal, the deploy or a poll of the
 * board never happens on the thread that draws the board.
 *
 * Plugged in through the embedded node's `createNode` seam, which exists for
 * exactly this, so `$lib/embedded` does not know a Worker is involved. Outside
 * a browser (unit tests, SSR) there is no `Worker` and the node stays on this
 * thread, so the unit tests run the world exactly as before.
 *
 * ONE CHOICE PER NODE: the restore probe and the world's node each take their
 * own, so each can be waited on to be gone ({@link OfflineNodeChoice.released}).
 */
export type OfflineNodeChoice = {
	where: 'worker' | 'main-thread';
	/** The factory to hand `startEmbeddedNode`; undefined on the main thread. */
	createNode?: StartEmbeddedNodeParams['createNode'];
	/** The adapter to hand `startEmbeddedNode`; undefined in a Worker, which builds its own. */
	persistence?: StartEmbeddedNodeParams['persistence'];
	/**
	 * Resolves once the node is gone for good: its Worker terminated, after
	 * every request sent to it has settled. Immediately on the main thread, and
	 * when no Worker was made.
	 */
	released(): Promise<void>;
};

/** What the client needs of a Worker. A parameter so a test can bring its own. */
export type WorkerLike = Endpoint & {terminate(): void};

export function offlineWorldNode(params: {
	/**
	 * The IndexedDB database the chain persists in. `undefined` for a chain that
	 * is never persisted, which lives as long as its node.
	 */
	db: string | undefined;
	/** Defaults to a Worker running `./offline-node-worker.ts`, when `Worker` exists. */
	worker?: () => WorkerLike;
}): OfflineNodeChoice {
	const makeWorker =
		params.worker ??
		(typeof Worker === 'undefined'
			? undefined
			: () =>
					new Worker(new URL('./offline-node-worker.ts', import.meta.url), {
						type: 'module',
					}));
	if (!makeWorker) {
		return {
			where: 'main-thread',
			...(params.db !== undefined
				? {persistence: createIndexedDBPersistence({db: params.db})}
				: {}),
			released: () => Promise.resolve(),
		};
	}

	let released: Promise<void> = Promise.resolve();
	const createNode = (async (options) => {
		const {persistence, engine, ...cloneable} = options ?? {};
		// HONEST EDGES: neither can be structured-cloned into a Worker, and both
		// would otherwise fail as an opaque `DataCloneError` deep in comlink.
		if (persistence !== undefined) {
			throw new Error(
				'the offline world builds its persistence inside the Worker: pass no `persistence` with a Worker-hosted node',
			);
		}
		if (engine !== undefined) {
			throw new Error('a Worker-hosted offline node takes no `engine`');
		}
		const draining = drainingWorker(makeWorker());
		released = draining.terminated;
		let node: SlimNode;
		try {
			node = await createWorkerNode({
				...(cloneable as OfflineNodeOptions),
				...(params.db !== undefined ? {indexedDB: params.db} : {}),
				worker: draining.worker as unknown as Worker,
			} as Parameters<typeof createWorkerNode>[0]);
		} catch (error) {
			// A node that never started still leaves no Worker behind.
			draining.worker.terminate();
			throw error;
		}
		return draining.track(node);
	}) as NonNullable<StartEmbeddedNodeParams['createNode']>;

	return {where: 'worker', createNode, released: () => released};
}

/**
 * THE WORKER IS TERMINATED ONLY ONCE EVERYTHING SENT TO IT HAS SETTLED.
 *
 * webevm's client terminates its Worker inside `dispose()`, right after the
 * node's own dispose. But a world is let go of as dispose THEN one more request
 * (`letGoOfWorld`, `$lib/embedded/claim.ts`): that request is the "everything
 * is saved" barrier, since a webevm node serialises its requests and resolves
 * each only after its block's `persistence.save()`. Terminated on the spot,
 * the barrier would never be answered (the take-over hangs) and a save still
 * running in the Worker could be cut.
 *
 * So the client is handed this Worker, whose `terminate()` sends a barrier of
 * its own and terminates for real only once that, and every other request in
 * flight, has settled, one task later so the callers' continuations have run
 * (and any request they chain counts too). A request after that is refused at
 * once rather than posted to a Worker that will never answer.
 */
function drainingWorker(real: WorkerLike) {
	let pending = 0;
	let stopping = false;
	let gone = false;
	let node: SlimNode | undefined;
	let markTerminated: () => void = () => {};
	const terminated = new Promise<void>((resolve) => {
		markTerminated = resolve;
	});

	function settleLater(): void {
		if (!stopping || gone || pending > 0) return;
		setTimeout(() => {
			if (gone || pending > 0) return;
			gone = true;
			real.terminate();
			markTerminated();
		}, 0);
	}

	const counted =
		<A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			if (gone) throw new Error("the offline world's node has been disposed");
			pending++;
			try {
				return await fn(...args);
			} finally {
				pending--;
				settleLater();
			}
		};

	const worker: WorkerLike = {
		postMessage: (...args: Parameters<WorkerLike['postMessage']>) =>
			real.postMessage(...args),
		addEventListener: (...args: Parameters<WorkerLike['addEventListener']>) =>
			real.addEventListener(...args),
		removeEventListener: (
			...args: Parameters<WorkerLike['removeEventListener']>
		) => real.removeEventListener(...args),
		...(real.start ? {start: () => real.start?.()} : {}),
		terminate() {
			if (stopping) return;
			stopping = true;
			if (!node) {
				settleLater();
				return;
			}
			// The barrier: answered only after everything queued before it.
			void counted(() => node!.request({method: 'eth_blockNumber'}))().catch(
				() => undefined,
			);
		},
	};

	return {
		worker,
		terminated,
		track(inner: SlimNode): SlimNode {
			node = inner;
			return {
				...inner,
				request: counted((args) => inner.request(args)),
				mine: counted(() => inner.mine()),
				dumpState: counted(() => inner.dumpState()),
				loadState: counted((state) => inner.loadState(state)),
				getStateRoot: counted(() => inner.getStateRoot()),
				dispose: () => inner.dispose(),
			} as SlimNode;
		},
	};
}
