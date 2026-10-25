import {describe, it, expect, vi, afterEach, beforeEach} from 'vitest';
import {get} from 'svelte/store';
import {createContext} from '$lib/context/index';
import type {ConnectionFactory} from '$lib/context/index';
import {resetTabNavigationForTests} from '$lib/context/tab';
import {establishRemoteConnection} from '$lib/core/connection';
import {definePromptOverlay} from '$lib/core/ui/overlay';
import {createFakeBrowser} from '../core/navigation/fake-browser';

// A SECOND CONTEXT IN THE TAB (a world beside the app) shares the app's
// navigation and a scope of its overlay registry. Before this, it built a
// navigation service nothing ever attached a driver to, so its overlays pushed
// no history entry and the back gesture meant to close one left the page,
// throwing the world away (measured on template-commit-reveal's /offline).
//
// Server project (Node). The lending is browser-only, so the browser cases
// stand up a `window` (an EventTarget is all the context's browser-only
// wiring needs at construction). The client project cannot import the real
// context: its env does not exist there.
const world: ConnectionFactory = (request) =>
	establishRemoteConnection(request);

function inABrowser() {
	vi.stubGlobal(
		'window',
		Object.assign(new EventTarget(), {location: new URL('https://app.test/')}),
	);
}

// The context, its registry and its navigation install console handles in a
// DEV browser; unstubbing `window` does not remove them.
const DEBUG_GLOBALS = ['overlays', 'appNavigation', 'context'] as const;

describe('the tab has one navigation', () => {
	beforeEach(() => {
		resetTabNavigationForTests();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		for (const name of DEBUG_GLOBALS) {
			delete (globalThis as Record<string, unknown>)[name];
		}
	});

	it('closes a world\u2019s prompt on the back gesture and stays on the page', () => {
		// THE BUG, end to end through the real contexts: with the app's driver
		// attached, the world's prompt pushes an entry and back takes only it.
		inABrowser();
		const browser = createFakeBrowser();
		const app = createContext();
		app.context.navigation.attach(browser.driver);
		const second = createContext({establishConnection: world});

		const menu = second.context.overlays.use(definePromptOverlay('menu'));
		menu.registerRenderer();
		menu.open();
		expect(browser.depth()).toBe(2);

		browser.back();
		expect(get(menu).open).toBe(false);
		expect(browser.index()).toBe(0);
		expect(browser.leftTheApp()).toBe(false);
	});

	it('keeps the world\u2019s overlays apart from the app\u2019s copies of them', () => {
		inABrowser();
		const app = createContext();
		const second = createContext({establishConnection: world});

		expect(second.context.navigation).toBe(app.context.navigation);

		const menu = definePromptOverlay('menu');
		const worldMenu = second.context.overlays.use(menu);
		const appMenu = app.context.overlays.use(menu);
		worldMenu.registerRenderer();
		worldMenu.open();

		expect(app.context.overlays.openLabels()).toEqual(['world-1/menu']);
		expect(get(appMenu).open).toBe(false);
		worldMenu.close();
	});

	it('gives each world its own scope', () => {
		inABrowser();
		createContext();
		const one = createContext({establishConnection: world});
		const two = createContext({establishConnection: world});
		const menu = definePromptOverlay('menu');
		const a = one.context.overlays.use(menu);
		const b = two.context.overlays.use(menu);
		a.registerRenderer();
		a.open();
		expect(get(b).open).toBe(false);
		a.close();
	});

	it('leaves the app\u2019s navigation running when a world is torn down', () => {
		// A world's teardown must stop its scope, never the service it borrowed.
		inABrowser();
		const browser = createFakeBrowser();
		const app = createContext();
		app.context.navigation.attach(browser.driver);
		const second = createContext({establishConnection: world});
		const stopWorld = second.start();
		stopWorld();

		const prompt = app.context.overlays.use(definePromptOverlay('confirm'));
		prompt.registerRenderer();
		prompt.open();
		browser.back();
		expect(get(prompt).open).toBe(false);
		expect(browser.leftTheApp()).toBe(false);
	});

	it('shares nothing on the server, where a module variable would be shared by every request', () => {
		const app = createContext();
		const second = createContext({establishConnection: world});
		expect(second.context.navigation).not.toBe(app.context.navigation);
	});
});
