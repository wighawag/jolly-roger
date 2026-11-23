/**
 * What the contracts page's suites send, as the main page's contract takes it.
 *
 * `fixtures/contracts-page.ts` drives the page with this and nothing else, so a
 * node whose contract is not this one sets these values and edits neither the
 * fixture nor the suites that read it (`contracts.e2e.ts`, `escape-hatch.e2e.ts`,
 * `pending-operation.e2e.ts`, `fixtures/stalling-wallet.ts`).
 */
export type MainPageWrite = {
	/**
	 * A write any fresh account may send, and that succeeds: the suites need a
	 * transaction, not this one, so it should change nothing that matters.
	 */
	readonly function: string;
	/**
	 * The form's values, one per input in the order the page lists them, made
	 * from a LABEL the suite picks so that each test sends something it can find
	 * again (a suite asserts its input survived). Valid for the input's type: a
	 * write taking an address or a number turns the label into one, and a `bool`
	 * is `'true'` or `'false'` (the fixture selects it).
	 */
	readonly args: (label: string) => readonly string[];
	/** Whether the main page shows the label once the write is mined. */
	readonly shownOnMainPage: boolean;
};

/**
 * THE APP'S MAIN PAGE, as the suites that visit it name it: its route, the
 * heading that page renders, the label of the home page's link to it, its
 * contract (as /contracts lists it), one of that contract's view functions and
 * the write the contracts page's suites send. The values are a node's own: here
 * the greetings demo and its GreetingsRegistry. The app names the same page in
 * `MAIN_PAGE` of its `$app-specific` module; a node changes both.
 */
export const MAIN_PAGE = {
	route: '/demo/',
	heading: /greetings registry/i,
	homeLink: /check the demo/i,
	contract: 'GreetingsRegistry',
	read: 'getLastMessages',
	write: {
		function: 'setMessage',
		args: (label: string) => [label],
		shownOnMainPage: true,
	} satisfies MainPageWrite,
} as const;

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
 * WHAT A DESCENDANT DOES: replaces the entries it does not have. Its main page
 * is `MAIN_PAGE.route`, so an app with no `/demo/` changes `MAIN_PAGE` above
 * and leaves this list alone. Keep `/` first: it is the only entry every
 * descendant is guaranteed to share.
 */
export const SMOKE_ROUTES = [
	'/',
	MAIN_PAGE.route,
	'/transactions/',
	'/explorer/',
] as const;
