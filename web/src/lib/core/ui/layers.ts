/**
 * The app's stacking layers: which containers exist, in what order they paint,
 * and what each one is a portal target for.
 *
 * WHY THIS EXISTS
 *
 * shadcn's overlay components (dialog, drawer, popover, select) each wrap
 * themselves in their OWN portal, which defaults to `document.body`, and each
 * carry `z-50`. Left alone, that means two things, both bad:
 *
 *  - Every overlay ties for z-index, so what paints on top is decided by DOM
 *    order, which is really mount order: whichever opened last wins.
 *  - A node appended to `body` lands AFTER these layer containers, so an
 *    overlay that forgot its target silently jumps above everything.
 *
 * That combination cost us a real bug: the account drawer was portalled to
 * `body`, so the top-up modal it opened itself rendered UNDERNEATH it, and the
 * click just looked broken.
 *
 * WHERE THE NUMBERS ARE, AND WHY NOT HERE
 *
 * The z-indexes live in `src/app.css`, as one scale of `--z-layer-*` custom
 * properties applied to `[data-layer]` containers. This file says which layers
 * EXIST and in which order; that file says what the order is worth. The split
 * is not decoration: a layer is two things that must not drift, a container to
 * render and a portal TARGET to name, and both of those are code rather than
 * style. `test/lib/core/ui/layers.test.ts` fails if the two files stop agreeing
 * about which layers exist or about their order, so neither can be edited alone.
 *
 * Within one layer, DOM order still decides, and that is deliberate: two modals
 * open at once should stack in the order they were declared (see
 * `context/AcrossPages.svelte`, where that order is load-bearing).
 */

export type Layer = {
	/**
	 * The `data-layer` value. This is what `app.css` matches on, so it is also
	 * the name of the `--z-layer-<name>` custom property that ranks it.
	 */
	readonly name: string;
	/** Element id of the container, so a portal can address it. */
	readonly id: string;
	/** Portal target, i.e. the id as a selector. This is what callers pass. */
	readonly selector: string;
	/** What belongs here, for whoever adds the next layer. */
	readonly holds: string;
};

function layer(name: string, id: string, holds: string): Layer {
	return {name, id, selector: `#${id}`, holds};
}

/**
 * BOTTOM TO TOP. The order of this array is the paint order, and it must match
 * the order of the `--z-layer-*` declarations in `app.css`.
 *
 * Only three of these are portal targets; the rest hold app-owned surfaces that
 * `+layout.svelte` renders into them directly. They are all in one list anyway,
 * because the question "what covers what" has to have exactly one answer.
 */
export const LAYERS = [
	layer(
		'drawer',
		'--layer-drawer',
		'Side panels. Below modals, because a panel is a place you act FROM: the ' +
			'modals it opens have to cover it.',
	),
	layer(
		'notice',
		'--layer-notice',
		'The update / install banner. An ambient report of something that ' +
			'happened, so a modal (the task in hand) covers it.',
	),
	layer(
		'toast',
		'--layer-toast',
		'Toasts and push notifications. Ambient too, but louder and shorter ' +
			'lived, so they sit above the banner.',
	),
	layer(
		'modal',
		'--layer-modals',
		'Modal dialogs. Above the ambient layers, because a modal is what the ' +
			'user is doing right now.',
	),
	layer(
		'popover',
		'--layer-popovers',
		'Popovers, tooltips and select menus: transient, dismissed by the next ' +
			'click, and anchored to something in a lower layer (often inside a ' +
			'modal), so always on top of it.',
	),
	layer(
		'progress',
		'--layer-progress',
		'The navigation progress bar. On top of everything because it is 2px ' +
			'tall and pointer-events: none, so being above a modal costs nothing ' +
			'and being under one would hide it.',
	),
] as const satisfies readonly Layer[];

const byName = (name: string): string => {
	const found = LAYERS.find((l) => l.name === name);
	if (!found) throw new Error(`no such layer: ${name}`);
	return found.selector;
};

/** Portal target for side panels. */
export const DRAWER_LAYER = byName('drawer');
/** Portal target for modal dialogs. */
export const MODAL_LAYER = byName('modal');
/** Portal target for popovers, tooltips and select menus. */
export const POPOVER_LAYER = byName('popover');
