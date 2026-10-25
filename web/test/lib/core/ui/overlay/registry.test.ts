import {describe, it, expect, vi} from 'vitest';
import {get} from 'svelte/store';
import {createNavigationService} from '../../../../../src/lib/core/navigation';
import {
	createOverlayRegistry,
	defineContentOverlay,
	definePromptOverlay,
} from '../../../../../src/lib/core/ui/overlay';
import {createFakeBrowser} from '../../navigation/fake-browser';

const inspector = defineContentOverlay('inspector', {param: 'operation'});

function setup(url?: string) {
	const browser = createFakeBrowser(url);
	const navigation = createNavigationService();
	const registry = createOverlayRegistry(navigation);
	navigation.attach(browser.driver);
	return {browser, navigation, registry};
}

describe('view overlay registry', () => {
	it('closes a view overlay when the app navigates to another page', () => {
		// The reported bug: inspect a transaction, click an address inside the
		// modal, and the modal used to survive onto the destination page.
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		overlay.registerRenderer();

		overlay.open('op-1');
		expect(get(overlay).open).toBe(true);

		browser.navigateTo('https://app.test/explorer/address/0x1/');

		expect(get(overlay).open).toBe(false);
		expect(registry.openLabels()).toEqual([]);
	});

	it('puts a content overlay in the URL and takes it back out', () => {
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		overlay.registerRenderer();

		overlay.open('op-1');
		expect(browser.current().url.searchParams.get('operation')).toBe('op-1');

		overlay.close();
		expect(browser.current().url.searchParams.get('operation')).toBeNull();
		expect(get(overlay).open).toBe(false);
	});

	it('keeps a prompt overlay out of the URL', () => {
		const {browser, registry} = setup();
		const prompt = registry.use(definePromptOverlay('confirm'));
		prompt.registerRenderer();

		prompt.open();

		expect(browser.current().url.href).toBe('https://app.test/transactions/');
		expect(browser.depth()).toBe(2);
		expect(get(prompt).open).toBe(true);
	});

	it('unwinds one level per back gesture', () => {
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		const prompt = registry.use(definePromptOverlay('confirm'));
		overlay.registerRenderer();
		prompt.registerRenderer();

		overlay.open('op-1');
		prompt.open();

		browser.back();
		expect(get(prompt).open).toBe(false);
		expect(get(overlay).open).toBe(true);

		browser.back();
		expect(get(overlay).open).toBe(false);
	});

	it('closing an overlay closes what it had open on top of it', () => {
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		const prompt = registry.use(definePromptOverlay('confirm'));
		overlay.registerRenderer();
		prompt.registerRenderer();

		overlay.open('op-1');
		prompt.open();
		overlay.close();

		expect(get(prompt).open).toBe(false);
		expect(get(overlay).open).toBe(false);
		// Both entries given back in one traversal, not one left behind.
		expect(browser.index()).toBe(0);
	});

	it('runs a prompt onClose however it is dismissed', () => {
		const {browser, registry} = setup();
		const onClose = vi.fn();
		const prompt = registry.use(
			definePromptOverlay<void>('confirm', {onClose}),
		);
		prompt.registerRenderer();

		prompt.open();
		prompt.close();
		expect(onClose).toHaveBeenCalledTimes(1);

		prompt.open();
		browser.back();
		expect(onClose).toHaveBeenCalledTimes(2);

		prompt.open();
		browser.navigateTo('https://app.test/explorer/');
		expect(onClose).toHaveBeenCalledTimes(3);
	});

	it('runs onClose on teardown, so a waiting asker is not abandoned', () => {
		// `onClose` is how a promise-shaped asker settles (`confirm()` resolving
		// false). Teardown used to set instances closed by hand, which skipped it
		// and left such a caller waiting forever.
		const {registry} = setup();
		const onClose = vi.fn();
		const prompt = registry.use(
			definePromptOverlay<void>('confirm', {onClose}),
		);
		prompt.registerRenderer();
		prompt.open();

		registry.stop();

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(get(prompt).open).toBe(false);
	});

	it('does not steal a history step when closing after the user moved on', () => {
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		overlay.registerRenderer();

		overlay.open('op-1');
		browser.navigateTo('https://app.test/explorer/');
		const depthBefore = browser.depth();
		const indexBefore = browser.index();

		// A late programmatic close (the transaction resolved, an action finished).
		overlay.close();

		expect(browser.index()).toBe(indexBefore);
		expect(browser.depth()).toBe(depthBefore);
		expect(browser.current().url.pathname).toBe('/explorer/');
	});

	it('restores a content overlay from the URL, and not a prompt', () => {
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		const prompt = registry.use(definePromptOverlay('confirm'));
		overlay.registerRenderer();
		prompt.registerRenderer();

		overlay.open('op-1');
		prompt.open();
		browser.navigateTo('https://app.test/explorer/');

		// Back into the page the overlay was opened from: the URL still says which
		// operation that entry was about, so the inspector comes back. The prompt
		// does not: it was a question about an action that is over.
		browser.back();

		expect(get(overlay).open).toBe(true);
		expect(get(overlay).payload).toBe('op-1');
		expect(get(prompt).open).toBe(false);
	});

	it('opens from a deep link, and closes without popping somebody else\u2019s entry', () => {
		const {browser, registry} = setup(
			'https://app.test/transactions/?operation=op-7',
		);
		const overlay = registry.use(inspector);
		overlay.registerRenderer();

		expect(get(overlay).open).toBe(true);
		expect(get(overlay).payload).toBe('op-7');

		overlay.close();

		expect(get(overlay).open).toBe(false);
		expect(browser.depth()).toBe(1);
		expect(browser.current().url.search).toBe('');
	});

	it('opening a prompt leaves the overlay underneath it open', () => {
		// Regression: the open path used to touch history BEFORE recording the
		// entry, so the listener met a token the stack did not know, read it as a
		// traversal, and closed the inspector the prompt was opened from.
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		const prompt = registry.use(definePromptOverlay('confirm'));
		overlay.registerRenderer();
		prompt.registerRenderer();

		overlay.open('op-1');
		prompt.open();

		expect(get(overlay).open).toBe(true);
		expect(get(prompt).open).toBe(true);
		expect(registry.openLabels()).toEqual(['inspector', 'confirm']);
		expect(browser.depth()).toBe(3);
	});

	it('closes on a link to the page it is already on', () => {
		// The case the navbar drawer used to handle by hand, with a
		// `showMenu = false` on every link: the destination is the current page, so
		// there is no route change, but the entry the router creates is not ours
		// and the overlay goes with it.
		const {browser, registry} = setup();
		const prompt = registry.use(definePromptOverlay('menu'));
		prompt.registerRenderer();

		prompt.open();
		browser.navigateTo('https://app.test/transactions/');

		expect(get(prompt).open).toBe(false);
	});

	it('closing a deep-linked overlay with a prompt on top gives back only what it pushed', () => {
		// Where the two ownership models meet: the content overlay ADOPTED the entry
		// the user arrived on (it cost no history entry), while the prompt above it
		// PUSHED one. Closing the pair must give back one entry, not two, and must
		// not leave the URL still addressing the overlay it just closed.
		const {browser, registry} = setup(
			'https://app.test/transactions/?operation=op-1',
		);
		const overlay = registry.use(inspector);
		const prompt = registry.use(definePromptOverlay('confirm'));
		overlay.registerRenderer();
		prompt.registerRenderer();

		prompt.open();
		overlay.close();

		expect(get(overlay).open).toBe(false);
		expect(get(prompt).open).toBe(false);
		// Popping two would have walked out of the app in a real browser, where
		// the entries before ours belong to wherever the user came from.
		expect(browser.leftTheApp(), 'must not traverse past its own entries').toBe(
			false,
		);
		// And whatever we land on must not re-address the overlay, or it reopens
		// the moment the location is read.
		expect(browser.current().url.search).toBe('');
		expect(get(overlay).open).toBe(false);
	});

	it('re-addresses the URL when retargeting an overlay opened from a deep link', () => {
		// Regression: the retarget path only rewrote the URL when the entry was one
		// WE pushed. Opened from a deep link the entry is adopted (no token), so the
		// state moved to op-2 while the URL still said op-1: a reload showed the
		// wrong operation, and the next location notification reverted the state.
		const {browser, registry} = setup(
			'https://app.test/transactions/?operation=op-1',
		);
		const overlay = registry.use(inspector);
		overlay.registerRenderer();
		expect(get(overlay).payload).toBe('op-1');

		overlay.open('op-2');

		expect(get(overlay).payload).toBe('op-2');
		expect(browser.current().url.searchParams.get('operation')).toBe('op-2');
		// Re-addressed, not claimed: the entry was the user's arrival point and we
		// must still not be able to pop it.
		expect(browser.current().state.overlayToken).toBeUndefined();
		expect(browser.depth()).toBe(1);
	});

	it('drops every content param when several close together', () => {
		// Regression: the fallback URL was recomputed from the current URL for each
		// overlay instead of chained, so only the last param was removed.
		// Both arrive from the URL, so both entries are adopted and closing cannot
		// pop: it has to rewrite, which is the path that has to remove BOTH params.
		const {browser, registry} = setup(
			'https://app.test/transactions/?operation=op-1&detail=d-9',
		);
		const other = defineContentOverlay('other', {param: 'detail'});
		const first = registry.use(inspector);
		const second = registry.use(other);
		first.registerRenderer();
		second.registerRenderer();

		expect(get(first).open).toBe(true);
		expect(get(second).open).toBe(true);

		// Closing the outer one closes everything above it, and none of them may be
		// left in the URL, or a reload brings them straight back.
		first.close();

		expect(get(first).open).toBe(false);
		expect(get(second).open).toBe(false);
		expect(browser.current().url.searchParams.get('operation')).toBeNull();
		expect(browser.current().url.searchParams.get('detail')).toBeNull();
	});

	it('does not churn a deep-linked overlay on unrelated notifications', () => {
		// Regression: an entry with no token was read as "everything is behind us",
		// so a deep-linked overlay closed and reopened on every notification, which
		// subscribers see as a flicker, and a prompt stacked above it was dropped.
		const {browser, registry} = setup(
			'https://app.test/transactions/?operation=op-1',
		);
		const overlay = registry.use(inspector);
		const prompt = registry.use(definePromptOverlay('confirm'));
		overlay.registerRenderer();
		prompt.registerRenderer();

		const seen: boolean[] = [];
		overlay.subscribe((state) => seen.push(state.open));
		expect(get(overlay).open).toBe(true);

		const before = seen.length;
		// A notification that changes nothing (the fake reports the same entry) must
		// produce no state change at all. Without the fix this emitted false then
		// true, because a token-less entry was read as "everything is behind us".
		browser.forward();
		expect(seen.length).toBe(before);
		expect(get(overlay).open).toBe(true);

		// And a prompt stacked above a deep-linked overlay survives it.
		prompt.open();
		browser.forward();
		expect(get(prompt).open).toBe(true);
		expect(get(overlay).open).toBe(true);
	});

	it('retargets rather than stacking when opened again while open', () => {
		const {browser, registry} = setup();
		const overlay = registry.use(inspector);
		overlay.registerRenderer();

		overlay.open('op-1');
		const depthAfterFirst = browser.depth();
		overlay.open('op-2');

		expect(get(overlay).payload).toBe('op-2');
		expect(browser.current().url.searchParams.get('operation')).toBe('op-2');
		expect(browser.depth()).toBe(depthAfterFirst);
	});
});

describe('a scope: a second context in the same tab', () => {
	// A world in the tab (context/core.ts, `establishConnection`) has overlays
	// of its own, and the tab has ONE history. Before scopes, the world's
	// context built a registry on a navigation service nobody had attached a
	// driver to: its prompts pushed no entry, and the back gesture meant to
	// close one walked out of the page instead.

	it('pushes a history entry, so the back gesture closes it and stays on the page', () => {
		const {browser, registry} = setup();
		const world = registry.scope('world');
		const menu = world.use(definePromptOverlay('menu'));
		menu.registerRenderer();

		menu.open();
		expect(browser.depth()).toBe(2);

		browser.back();
		expect(get(menu).open).toBe(false);
		expect(browser.index()).toBe(0);
		expect(browser.leftTheApp()).toBe(false);
		expect(browser.current().url.href).toBe('https://app.test/transactions/');
	});

	it('keeps the same overlay apart from the app\u2019s copy of it', () => {
		// The reason a scope is not simply the app's registry: instances are
		// keyed by label, and a world renders the same system overlays the app
		// does. Shared, the world's confirmation opened the app's too.
		const {registry} = setup();
		const confirm = definePromptOverlay('confirm');
		const app = registry.use(confirm);
		const world = registry.scope('world').use(confirm);
		app.registerRenderer();
		world.registerRenderer();

		world.open();
		expect(get(world).open).toBe(true);
		expect(get(app).open).toBe(false);
		expect(registry.openLabels()).toEqual(['world/confirm']);
		expect(registry.scope('world').openLabels()).toEqual(['confirm']);
	});

	it('unwinds in one stack with the app\u2019s overlays', () => {
		const {browser, registry} = setup();
		const app = registry.use(inspector);
		const world = registry.scope('world').use(definePromptOverlay('menu'));
		app.registerRenderer();
		world.registerRenderer();

		app.open('op-1');
		world.open();

		browser.back();
		expect(get(world).open).toBe(false);
		expect(get(app).open).toBe(true);

		browser.back();
		expect(get(app).open).toBe(false);
	});

	it('namespaces a content overlay\u2019s param, so the app\u2019s does not adopt it', () => {
		const {browser, registry} = setup();
		const app = registry.use(inspector);
		const world = registry.scope('world').use(inspector);
		app.registerRenderer();
		world.registerRenderer();

		world.open('op-9');
		expect(browser.current().url.searchParams.get('world.operation')).toBe(
			'op-9',
		);
		expect(browser.current().url.searchParams.get('operation')).toBeNull();
		expect(get(app).open).toBe(false);
	});

	it('stops only its own overlays, in memory, leaving history and the app\u2019s overlays alone', () => {
		// IN MEMORY because a scope stops when its context is torn down, which is
		// usually a route change in progress: going back from there would undo
		// the user's navigation, and in a real browser several async `go()`s in
		// a row strand entries. Its entries stay, as on a route change.
		const onClose = vi.fn();
		const {browser, registry} = setup();
		const world = registry.scope('world');
		const app = registry.use(definePromptOverlay('confirm'));
		const first = world.use(definePromptOverlay<void>('menu', {onClose}));
		const second = world.use(definePromptOverlay('detail'));
		app.registerRenderer();
		first.registerRenderer();
		second.registerRenderer();

		app.open();
		first.open();
		second.open();
		const indexBefore = browser.index();
		world.stop();

		expect(get(first).open).toBe(false);
		expect(get(second).open).toBe(false);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(browser.index()).toBe(indexBefore);
		expect(get(app).open).toBe(true);
		expect(registry.openLabels()).toEqual(['confirm']);

		// The registry still follows navigation: back over the world's two
		// entries, then the app's own prompt closes on the next one.
		browser.back(3);
		expect(get(app).open).toBe(false);
	});

	it('keeps a handle taken before stop working after the context starts again', () => {
		// A world's context is stopped and started on the same objects (it
		// outlives the route that shows it), and the toast connector takes its
		// handle once, at construction. If stop forgot the instance, that handle
		// would open one overlay and a remounted renderer would show another.
		const {browser, registry} = setup();
		const world = registry.scope('world');
		const prompt = definePromptOverlay('menu');
		const early = world.use(prompt);
		early.registerRenderer();

		world.stop();
		const late = registry.scope('world').use(prompt);

		early.open();
		expect(get(late).open).toBe(true);
		browser.back();
		expect(get(late).open).toBe(false);
	});

	it('is one scope per name, so the same definition used twice is one overlay', () => {
		const {registry} = setup();
		const prompt = definePromptOverlay('menu');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const a = registry.scope('world').use(prompt);
		const b = registry.scope('world').use(prompt);
		a.registerRenderer();
		a.open();
		expect(get(b).open).toBe(true);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
