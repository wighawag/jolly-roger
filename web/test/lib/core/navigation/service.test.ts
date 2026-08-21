import {describe, it, expect} from 'vitest';
import {createNavigationService} from '../../../../src/lib/core/navigation';
import {createFakeBrowser} from './fake-browser';

describe('navigation service', () => {
	it('knows nothing and does nothing before a driver is attached', () => {
		const navigation = createNavigationService();

		// The server, and the client before hydration: no history to speak of.
		expect(navigation.current()).toBeUndefined();
		expect(navigation.urlWithParam('operation', 'x')).toBeUndefined();
		expect(navigation.dropEphemeral('anything')).toBe('ignored');
		expect(() => navigation.pushEphemeral('anything')).not.toThrow();
	});

	it('pushes an entry that keeps the URL identical', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		navigation.pushEphemeral('token-1');

		expect(browser.depth()).toBe(2);
		expect(browser.current().url.href).toBe('https://app.test/transactions/');
		expect(navigation.current()?.token).toBe('token-1');
	});

	it('pops only the entry it owns', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		navigation.pushEphemeral('token-1');
		expect(navigation.dropEphemeral('token-1')).toBe('popped');
		expect(browser.index()).toBe(0);
	});

	it('leaves history alone when the current entry is somebody else', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		navigation.pushEphemeral('token-1');
		// The user moved on: a close arriving now must not yank them back.
		browser.navigateTo('https://app.test/explorer/address/0x1/');

		expect(navigation.dropEphemeral('token-1')).toBe('ignored');
		expect(browser.index()).toBe(2);
		expect(browser.current().url.pathname).toBe('/explorer/address/0x1/');
	});

	it('rewrites the current entry instead of popping when given a fallback', () => {
		const browser = createFakeBrowser(
			'https://app.test/transactions/?operation=abc',
		);
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		// Nothing was pushed: this is a deep link, so the entry is not ours.
		const fallbackUrl = navigation.urlWithParam('operation', null)!;
		expect(navigation.dropEphemeral('not-ours', {fallbackUrl})).toBe(
			'replaced',
		);

		expect(browser.depth()).toBe(1);
		expect(browser.current().url.search).toBe('');
	});

	it('pops a nested stack in one traversal', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		navigation.pushEphemeral('outer');
		navigation.pushEphemeral('inner');

		expect(navigation.dropEphemeral('inner', {count: 2})).toBe('popped');
		expect(browser.index()).toBe(0);
	});

	it('reports location changes it did not cause', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		const seen: (string | undefined)[] = [];
		navigation.attach(browser.driver);
		navigation.subscribe((location) => seen.push(location?.url.pathname));

		browser.navigateTo('https://app.test/explorer/');

		expect(seen.at(-1)).toBe('/explorer/');
	});

	it('goes inert again when detached', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		const detach = navigation.attach(browser.driver);

		detach();

		expect(navigation.current()).toBeUndefined();
	});
});

describe('navigation service: guardUnload', () => {
	it('warns only while the domain condition holds', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		let requestOutstanding = false;
		navigation.guardUnload(() => requestOutstanding);

		expect(browser.wouldPromptOnUnload()).toBe(false);
		requestOutstanding = true;
		expect(browser.wouldPromptOnUnload()).toBe(true);
	});

	it('keeps a guard registered before a driver attaches', () => {
		// The context is built before hydration (ADR-0002), so this is the normal
		// order rather than an edge case: dropping it would mean the guard is only
		// ever installed by whatever happens to register late.
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.guardUnload(() => true);

		navigation.attach(browser.driver);

		expect(browser.wouldPromptOnUnload()).toBe(true);
	});

	it('stops warning once the guard is unregistered', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		const stop = navigation.guardUnload(() => true);
		expect(browser.wouldPromptOnUnload()).toBe(true);

		stop();
		expect(browser.wouldPromptOnUnload()).toBe(false);
	});

	it('warns when any one guard says so', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		navigation.guardUnload(() => false);
		navigation.guardUnload(() => true);

		expect(browser.wouldPromptOnUnload()).toBe(true);
	});

	it('never traps the user because a guard threw', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		navigation.guardUnload(() => {
			throw new Error('broken predicate');
		});

		expect(browser.wouldPromptOnUnload()).toBe(false);
	});

	it('still lets a broken guard be outvoted by a working one', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		navigation.guardUnload(() => {
			throw new Error('broken predicate');
		});
		navigation.guardUnload(() => true);

		expect(browser.wouldPromptOnUnload()).toBe(true);
	});

	it('uninstalls the driver hook when detached', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		const detach = navigation.attach(browser.driver);
		navigation.guardUnload(() => true);

		detach();

		expect(browser.wouldPromptOnUnload()).toBeUndefined();
	});

	it('is a no-op, not a crash, on a driver that cannot offer it', () => {
		// A driver without the hook degrades to no prompt at all, which is the
		// honest failure: the prompt was never the safety mechanism.
		const browser = createFakeBrowser();
		const {guardUnload: _omitted, ...withoutGuard} = browser.driver;
		const navigation = createNavigationService();

		expect(() => navigation.attach(withoutGuard)).not.toThrow();
		expect(() => navigation.guardUnload(() => true)).not.toThrow();
	});

	it('registers with a driver attached later, after an earlier one went away', () => {
		const navigation = createNavigationService();
		navigation.guardUnload(() => true);

		const first = createFakeBrowser();
		navigation.attach(first.driver)();

		const second = createFakeBrowser();
		navigation.attach(second.driver);

		expect(second.wouldPromptOnUnload()).toBe(true);
	});
});

describe('navigation service: teardown', () => {
	it('can be stopped without a driver ever having been attached', () => {
		// The server, and a client that never hydrated. Nothing to release, and
		// nothing to throw about.
		const navigation = createNavigationService();
		expect(() => navigation.stop()).not.toThrow();
	});

	it('stopping does not disturb an attached driver', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.attach(browser.driver);
		navigation.guardUnload(() => true);

		navigation.stop();

		// stop() releases the service's own handle; detaching is attach's teardown.
		expect(browser.wouldPromptOnUnload()).toBe(true);
		expect(navigation.current()).toBeDefined();
	});
});

describe('navigation service: knowing whether the browser hook is installed', () => {
	// The distinction that made a reported bug undebuggable: the app can hold a
	// perfectly good predicate while nothing is listening to the browser, and
	// from outside that is indistinguishable from the browser declining to show
	// a dialog.
	it('reports the hook as installed only once a driver takes it', () => {
		const browser = createFakeBrowser();
		const navigation = createNavigationService();
		navigation.guardUnload(() => true);

		// A guard registered, but nothing listening yet.
		expect(browser.wouldPromptOnUnload()).toBeUndefined();

		const detach = navigation.attach(browser.driver);
		expect(browser.wouldPromptOnUnload()).toBe(true);

		detach();
		expect(browser.wouldPromptOnUnload()).toBeUndefined();
	});

	it('a driver that cannot guard leaves nothing installed', () => {
		const browser = createFakeBrowser();
		const {guardUnload: _omitted, ...withoutGuard} = browser.driver;
		const navigation = createNavigationService();

		navigation.attach(withoutGuard);
		navigation.guardUnload(() => true);

		// The app would block; the browser will never be asked. Exactly the state
		// that has to be visible rather than inferred.
		expect(browser.wouldPromptOnUnload()).toBeUndefined();
	});
});
