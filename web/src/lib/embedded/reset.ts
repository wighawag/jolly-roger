import {writable, type Readable} from 'svelte/store';

/**
 * START A FRESH WORLD IN THIS TAB: stop the one running, forget it, and reload
 * into a new one.
 *
 * WHY IT RELOADS rather than booting the next world in place, and it is the same
 * reason the claim's hand-over does (`./claim.ts`): everything a world started
 * is app-scoped (the boot, the announced wallet, a game's seats, an indexer, the
 * polling a context leaves behind), and a reset that left any of it running would
 * be a second writer beside the new world, one the player cannot see. A reload
 * stops all of it for certain, and the page that comes back boots by the
 * ordinary path, which, with the id forgotten, mints a new one. template-commit-
 * reveal's "leave the table" is the same three steps for the same reason.
 *
 * THE CLAIM NEEDS NOTHING: the tab keeps holding the world's name until the
 * reload releases it, and the reloaded tab claims it again. The name is the
 * app's world, not its chain id, exactly so that a new id inside one tab changes
 * nothing about which tab has it.
 *
 * THE ORDER IS THE POINT. The state says `Resetting` first, so a route renders
 * something else in place of the world and its subtree unmounts (its writers
 * stop); then the world is let go of (stopped, and everything already sent to
 * it saved: `letGoOfWorld`); then forgotten, so nothing a stopping world still
 * did can write its id back; then the reload. A world that would not stop is
 * forgotten and reloaded anyway, which is what stops it.
 *
 * MECHANISM, SO IT SAYS NOTHING ABOUT `offline`: what to let go of and what to
 * forget are the app's, as the world is.
 */

export type WorldResetState = {step: 'Idle'} | {step: 'Resetting'};

export type WorldResetParams = {
	/** Stop this tab's world. See `letGoOfWorld` for the part every world shares. */
	letGo(): Promise<void>;
	/** Forget the world, so the next boot builds a new one. See `forgetChainId`. */
	forget(): void;
	/** Defaults to `location.reload()`. */
	reload?: () => void;
};

export type WorldReset = Readable<WorldResetState> & {
	/** Stop, forget and reload. A second call while one runs joins it. */
	reset(): Promise<void>;
};

export function createWorldReset(params: WorldResetParams): WorldReset {
	const state = writable<WorldResetState>({step: 'Idle'});
	let running: Promise<void> | undefined;

	function reload(): void {
		if (params.reload) params.reload();
		else if (typeof location !== 'undefined') location.reload();
	}

	async function run(): Promise<void> {
		state.set({step: 'Resetting'});
		// One task, so a route reading the state has unmounted the world's
		// subtree before anything here disposes what it was using.
		await new Promise((resolve) => setTimeout(resolve, 0));
		try {
			await params.letGo();
		} catch (error) {
			console.error(
				'stopping the world failed, starting a fresh one anyway',
				error,
			);
		}
		params.forget();
		reload();
	}

	return {
		subscribe: state.subscribe,
		reset(): Promise<void> {
			running ??= run();
			return running;
		},
	};
}
