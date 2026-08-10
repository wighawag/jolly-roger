/**
 * The app's stacking layers: the containers every portalled overlay is sent
 * to, and the order they paint in.
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
 * So order is stated here, as an explicit z-index per layer, and each layer
 * container is a stacking context (see `+layout.svelte`). The `z-50` the
 * overlays carry then only sorts them WITHIN their layer, and no amount of
 * mount-order luck can float a drawer above a modal.
 *
 * Within one layer, DOM order still decides, and that is deliberate: two
 * modals open at once should stack in the order they were declared (see
 * `context/AcrossPages.svelte`).
 */

/**
 * A layer's z-index. Values are spaced so a layer can be slipped between two
 * others without renumbering, and all sit BELOW the notification overlay
 * (`z-999`) and the navigation progress bar (`z-9999`), which are app-level
 * signals that a blocking overlay must never hide.
 */
export type Layer = {
	/** Element id of the container, rendered by `+layout.svelte`. */
	readonly id: string;
	/** Portal target, i.e. the id as a selector. This is what callers pass. */
	readonly selector: string;
	readonly z: number;
	/** What belongs here, for whoever adds the next layer. */
	readonly holds: string;
};

function layer(id: string, z: number, holds: string): Layer {
	return {id, selector: `#${id}`, z, holds};
}

/**
 * BOTTOM TO TOP. The order of this array is the paint order, and the test in
 * `test/lib/core/ui/layers.test.ts` holds it to that: z must increase.
 */
export const LAYERS = [
	layer(
		'--layer-drawer',
		100,
		'Side panels. Below modals, because a panel is a place you act FROM: the ' +
			'modals it opens have to cover it.',
	),
	layer(
		'--layer-modals',
		200,
		'Modal dialogs. Above panels, below popovers, because a modal can contain ' +
			'a popover (an address, an avatar) and must not clip it.',
	),
	layer(
		'--layer-popovers',
		300,
		'Popovers, tooltips and select menus: transient, dismissed by the next ' +
			'click, and anchored to something in a lower layer, so always on top.',
	),
] as const satisfies readonly Layer[];

const bySuffix = (suffix: string): string => {
	const found = LAYERS.find((l) => l.id === `--layer-${suffix}`);
	if (!found) throw new Error(`no such layer: ${suffix}`);
	return found.selector;
};

/** Portal target for side panels. */
export const DRAWER_LAYER = bySuffix('drawer');
/** Portal target for modal dialogs. */
export const MODAL_LAYER = bySuffix('modals');
/** Portal target for popovers, tooltips and select menus. */
export const POPOVER_LAYER = bySuffix('popovers');
