import type {Readable} from 'svelte/store';

/**
 * View overlays (ADR-0004, `work` branch).
 *
 * An overlay whose visibility IS its state, as opposed to a SYSTEM overlay whose
 * visibility is derived from domain state (`$connection.step`, `$balanceCheck`,
 * ...). System overlays are not declared here and the registry never touches
 * them: the condition that opened them is still true on the next page, so
 * closing them on navigation would be a lie.
 *
 * There are exactly two kinds and NEITHER is the default, because the question
 * they answer ("should this survive a reload?") has an obvious answer at the
 * moment of writing and no obvious answer later.
 */

/** Content: shows a thing. Addressable, restored from the URL, back-closable. */
export type ContentOverlayDefinition = {
	kind: 'content';
	label: string;
	/** Query param carrying the id. Its presence in the URL IS the open state. */
	param: string;
};

/** Prompt: asks about an action in flight. Never in the URL, never restored. */
export type PromptOverlayDefinition<Payload> = {
	kind: 'prompt';
	label: string;
	/**
	 * Run whenever the overlay closes, WHATEVER the cause: the confirm button,
	 * ESC, a click outside, the back gesture, a navigation, or a programmatic
	 * close. This is the hook that lets a promise-shaped asker (a
	 * `confirm(): Promise<boolean>`) settle exactly once however the question
	 * goes away, so it must be idempotent with respect to its own resolution.
	 */
	onClose?: (payload: Payload) => void;
};

export type ViewOverlayDefinition<Payload = unknown> =
	ContentOverlayDefinition | PromptOverlayDefinition<Payload>;

/**
 * A content overlay is keyed by the string it puts in the URL; a prompt carries
 * whatever its definition says.
 *
 * `never` for anything else, deliberately: resolving an unrecognised type to
 * `string` would let a mistyped definition pass as a content overlay and fail
 * at runtime instead of here.
 */
export type PayloadOf<Definition> = Definition extends ContentOverlayDefinition
	? string
	: Definition extends PromptOverlayDefinition<infer Payload>
		? Payload
		: never;

export type OverlayState<Payload> =
	{open: false; payload?: undefined} | {open: true; payload: Payload};

export type ViewOverlay<Payload> = Readable<OverlayState<Payload>> & {
	open(payload: Payload): void;
	/**
	 * Close, and give back the history entry if it is still ours.
	 *
	 * EVERY dismissal path has to end up here (the confirm button, ESC, the click
	 * outside, the X, the back gesture, a navigation, an action completing).
	 * A path that bypasses it leaks a history entry and makes the back gesture
	 * appear dead, which is the main failure mode of this design.
	 */
	close(): void;
	/**
	 * Announce that something is rendering this overlay. Returns a teardown, so
	 * the usual call site is `$effect(() => overlay.registerRenderer())`. Opening
	 * an overlay nobody renders is otherwise a silent no-op, which is a miserable
	 * thing to debug in a template.
	 */
	registerRenderer(): () => void;
};

export function defineContentOverlay(
	label: string,
	options: {param: string},
): ContentOverlayDefinition {
	return {kind: 'content', label, param: options.param};
}

export function definePromptOverlay<Payload = void>(
	label: string,
	options?: {onClose?: (payload: Payload) => void},
): PromptOverlayDefinition<Payload> {
	return {kind: 'prompt', label, onClose: options?.onClose};
}
