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
