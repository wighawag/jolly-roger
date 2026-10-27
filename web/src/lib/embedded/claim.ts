import {writable, type Readable} from 'svelte/store';
import type {EIP1193ProviderLike} from './types.js';

/**
 * ONE TAB PER WORLD: the claim a tab takes before it boots a world, and the way
 * another tab asks for it.
 *
 * WHY A WORLD NEEDS ONE. A world is persisted in the browser (webevm's dump, the
 * deployment records, the chain id in `localStorage`), so a second tab on the
 * same page restores the same chain, boots a second node from it, and from then
 * on each tab mines its own blocks and saves its own dump over the other's.
 * Nothing about either tab looks wrong while it happens; the two copies simply
 * stop being one world, and the player finds out on a reload.
 *
 * SO A TAB HOLDS A WEB LOCK FOR AS LONG AS IT HAS THE WORLD, and a tab that cannot
 * take it does not boot. A Web Lock rather than a `localStorage` heartbeat or a
 * `BroadcastChannel` election, because the browser releases a lock when its tab
 * closes, crashes or reloads, and a heartbeat leaves a stale holder after a crash
 * that a second mechanism then has to time out. The lock is the guarantee; the
 * channel below only carries a request.
 *
 * THE NAME IS THE APP'S WORLD, NOT A CHAIN ID, and that is measured rather than
 * tidy. One browser holds one world per app at a time (its id is one
 * `localStorage` key), and the id CHANGES inside a boot: an incoherent restore
 * mints a new one and boots it in the same call, and leaving the table drops it.
 * A lock named by the id would be released or missed at exactly those moments,
 * and a second tab reading the fresh id would claim it successfully.
 *
 * TAKING THE WORLD OVER is a message and a wait, and the holder does the work.
 * The asking tab posts {@link LET_GO} on a channel of the same name and queues an
 * ordinary request for the lock. The holder, on hearing it, says so first (its
 * state becomes `LettingGo`, which a route renders instead of the world, so the
 * world unmounts and its writers stop), then lets go of the world (the app's
 * `letGo`, see {@link letGoOfWorld}), then RELOADS. The reload is what releases
 * the lock, and it is deliberate rather than an in-process release: everything a
 * world started is app-scoped (the boot, the wallet, a game's seats, an indexer),
 * and a release that left any of it running would be a second writer beside the
 * next holder. A reloaded holder asks again, finds the lock taken, and lands on
 * the refusal.
 *
 * MECHANISM, SO IT SAYS NOTHING ABOUT `offline`. Which name to claim, what letting
 * go of a world involves and what the refusal says are the app's, exactly as the
 * world itself is; this is only the lock and the request.
 */

/** The one message on a claim's channel: "the tab holding this, please let go". */
export const LET_GO = 'let-go';

export type WorldClaimState =
	/** Nothing asked yet. Prerendered HTML is in this state, and so is SSR. */
	| {step: 'Unasked'}
	/** This tab has the world. */
	| {step: 'Held'}
	/** Another tab has it. This tab must not boot it. */
	| {step: 'Refused'}
	/** This tab asked the holder to let go, and is waiting for the lock. */
	| {step: 'Waiting'}
	/** Another tab asked for the world, and this tab is handing it over. */
	| {step: 'LettingGo'};

/** The part of `navigator.locks` a claim uses. */
export type LocksLike = {
	request(
		name: string,
		options: {ifAvailable?: boolean; signal?: AbortSignal},
		callback: (lock: unknown) => Promise<unknown> | unknown,
	): Promise<unknown>;
};

/** The part of a `BroadcastChannel` a claim uses. */
export type ChannelLike = {
	postMessage(message: unknown): void;
	addEventListener(
		type: 'message',
		listener: (event: {data: unknown}) => void,
	): void;
	close(): void;
};

export type WorldClaimParams = {
	/** The lock's name, and the channel's. See the module note for which name. */
	name: string;
	/**
	 * Stop this tab's world writing, before the reload hands it over.
	 *
	 * Called once the state already says `LettingGo`, so whatever renders the
	 * world has been told to unmount it. See {@link letGoOfWorld} for the part
	 * every world shares.
	 */
	letGo(): Promise<void>;
	/** Defaults to `navigator.locks`. A parameter so a test can bring its own. */
	locks?: LocksLike;
	/** Defaults to `new BroadcastChannel(name)`. */
	openChannel?: (name: string) => ChannelLike;
	/** Defaults to `location.reload()`. What releases the lock when letting go. */
	reload?: () => void;
};

export type WorldClaim = Readable<WorldClaimState> & {
	/**
	 * Take the world if no other tab has it. Resolves `true` when this tab holds
	 * it, `false` when it is refused; never waits for another tab.
	 */
	claim(): Promise<boolean>;
	/**
	 * Ask the tab that holds the world to let go, and wait for it. Resolves once
	 * this tab holds the world, so the caller boots it by the ordinary restore.
	 */
	takeOver(): Promise<void>;
	/** Stop waiting for a take-over, back to `Refused`. */
	abandon(): void;
	/**
	 * Release the lock WITHOUT reloading, resolving once it is free.
	 *
	 * ONLY for a context that is going away anyway: a test, or a page being torn
	 * down. A live page that releases while its world still runs is the second
	 * writer this module exists to prevent.
	 */
	release(): Promise<void>;
};

export function createWorldClaim(params: WorldClaimParams): WorldClaim {
	const state = writable<WorldClaimState>({step: 'Unasked'});
	let current: WorldClaimState = {step: 'Unasked'};
	const set = (next: WorldClaimState) => {
		current = next;
		state.set(next);
	};

	let releaseHeld: (() => void) | undefined;
	let heldRequest: Promise<unknown> | undefined;
	let channel: ChannelLike | undefined;
	let waiting: AbortController | undefined;

	function locks(): LocksLike | undefined {
		if (params.locks) return params.locks;
		return typeof navigator !== 'undefined' && navigator.locks
			? (navigator.locks as unknown as LocksLike)
			: undefined;
	}

	function openChannel(): ChannelLike | undefined {
		if (params.openChannel) return params.openChannel(params.name);
		return typeof BroadcastChannel !== 'undefined'
			? (new BroadcastChannel(params.name) as unknown as ChannelLike)
			: undefined;
	}

	function reload(): void {
		if (params.reload) params.reload();
		else if (typeof location !== 'undefined') location.reload();
	}

	async function handOver(): Promise<void> {
		if (current.step !== 'Held') return;
		set({step: 'LettingGo'});
		// One task, so a route reading the state has rendered the refusal and its
		// world's subtree has unmounted (its context stopped) before anything here
		// disposes what that subtree was using.
		await new Promise((resolve) => setTimeout(resolve, 0));
		try {
			await params.letGo();
		} catch (error) {
			// RELOADED ANYWAY. A world that would not stop is still this tab's,
			// and the reload is what stops it for certain; keeping the lock
			// instead would leave the asking tab waiting on a world nobody plays.
			console.error('letting go of the world failed, reloading anyway', error);
		}
		reload();
	}

	function listen(): void {
		channel = openChannel();
		channel?.addEventListener('message', (event) => {
			if (event.data === LET_GO) void handOver();
		});
	}

	/** Hold the lock until released. Called from inside a granted request. */
	function hold(): Promise<void> {
		set({step: 'Held'});
		listen();
		return new Promise<void>((resolve) => {
			releaseHeld = resolve;
		});
	}

	async function release(): Promise<void> {
		channel?.close();
		channel = undefined;
		waiting?.abort();
		waiting = undefined;
		const held = releaseHeld;
		const request = heldRequest;
		releaseHeld = undefined;
		heldRequest = undefined;
		held?.();
		// The lock is free once the request that held it has settled, which is a
		// step after its callback's promise resolves.
		await request?.catch(() => undefined);
	}

	return {
		subscribe: state.subscribe,
		claim(): Promise<boolean> {
			if (current.step === 'Held' || current.step === 'LettingGo') {
				return Promise.resolve(true);
			}
			const manager = locks();
			// A BROWSER WITHOUT WEB LOCKS IS NOT GUARDED, rather than refused: every
			// browser this app supports has them, and refusing would make a world
			// unplayable to prevent a hazard the player may never meet.
			if (!manager) {
				set({step: 'Held'});
				return Promise.resolve(true);
			}
			return new Promise<boolean>((answer) => {
				const request = manager
					.request(params.name, {ifAvailable: true}, (lock) => {
						if (!lock) {
							set({step: 'Refused'});
							answer(false);
							return undefined;
						}
						answer(true);
						return hold();
					})
					.catch(() => {
						// A request that throws (a lock manager refusing an opaque
						// origin) is treated as no guard, for the reason above.
						set({step: 'Held'});
						answer(true);
					});
				// AFTER THE CALL, not in its callback: a lock manager may run the
				// callback before `request` returns (Node's does), when the
				// promise does not exist yet. Kept whatever the answer, since a
				// refused request has already settled and awaiting it is free.
				heldRequest = request;
			});
		},
		takeOver(): Promise<void> {
			const manager = locks();
			if (!manager) {
				set({step: 'Held'});
				return Promise.resolve();
			}
			set({step: 'Waiting'});
			const controller = new AbortController();
			waiting = controller;
			return new Promise<void>((granted, failed) => {
				const request = manager
					.request(params.name, {signal: controller.signal}, () => {
						waiting = undefined;
						granted();
						return hold();
					})
					.catch((error: unknown) => {
						if (controller.signal.aborted) return;
						failed(error);
					});
				heldRequest = request;
				// ASKED AFTER THE REQUEST IS MADE, so the request is in the lock's
				// queue long before the holder has disposed, saved and reloaded, and
				// the release goes to this tab rather than to the reloaded holder,
				// whose `claim` only ever asks `ifAvailable`.
				const asking = openChannel();
				asking?.postMessage(LET_GO);
				asking?.close();
			});
		},
		abandon(): void {
			if (current.step !== 'Waiting') return;
			waiting?.abort();
			waiting = undefined;
			set({step: 'Refused'});
		},
		release,
	};
}

/**
 * What every world shares in letting go: wait for its boot, stop its node, and
 * wait until everything already sent to it is saved.
 *
 * THE LAST STEP IS THE ONE THAT MATTERS, because `dispose()` is not a barrier.
 * webevm's `dispose` stops its timer and its served ports and does NOT cancel
 * work already queued, nor wait for it; every request is serialised and resolves
 * only after its block's `persistence.save()`. So one more request, sent after
 * the world has stopped issuing them, resolves only when every write accepted
 * before it is durable, and a reload after that cannot cut a save in flight.
 *
 * A boot that failed, or a world never started, has nothing to let go of.
 */
export async function letGoOfWorld(
	boot:
		| Promise<
				| {
						step: string;
						world?: {provider: EIP1193ProviderLike; dispose(): Promise<void>};
				  }
				| undefined
		  >
		| undefined,
): Promise<void> {
	if (!boot) return;
	const status = await boot.catch(() => undefined);
	const world = status?.step === 'Ready' ? status.world : undefined;
	if (!world) return;
	await world.dispose();
	await world.provider.request({method: 'eth_blockNumber'});
}
