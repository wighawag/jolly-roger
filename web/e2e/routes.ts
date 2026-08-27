/**
 * The routes a smoke test walks, in ONE place so a descendant overrides a list
 * rather than editing a suite.
 *
 * WHY THIS FILE EXISTS. Inherited suites used to carry route literals, and a
 * descendant that replaced the demo route inherited a test pointing at a path
 * it does not have. That does not fail: SvelteKit answers with the 404 page,
 * the assertions about the shell still hold on it, and the test PASSES while
 * testing nothing. It is the quietest possible regression, it has bitten this
 * tree at least twice (see `bleeps@4d09f4a1`, "ONE TEST WAS PASSING ON A 404"),
 * and both times it was found by accident.
 *
 * So the list is data, and it is short enough to keep honest.
 *
 * WHAT BELONGS HERE: routes every page-level guarantee should hold on, which in
 * practice means one route per kind of page the app has. Not every route. A
 * smoke pass that walks thirty pages is a slow way to learn the same fact.
 *
 * WHAT A DESCENDANT DOES: replaces the entries it does not have. An app with no
 * `/demo/` swaps in its own main route. Keep `/` first: it is the only entry
 * every descendant is guaranteed to share.
 */
export const SMOKE_ROUTES = [
	'/',
	'/demo/',
	'/transactions/',
	'/explorer/',
] as const;
