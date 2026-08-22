import {describe, it, expect} from 'vitest';
import {get} from 'svelte/store';
import {
	createHexLocationParamStore,
	extractHexParam,
} from '../../../src/routes/explorer/lib/location-param';
import {createNavigationService} from '../../../src/lib/core/navigation';
import {createFakeBrowser} from '../../lib/core/navigation/fake-browser';

const HASH = '0x' + 'a'.repeat(64);
const ADDR = '0x' + '1'.repeat(40);

describe('extractHexParam', () => {
	it('prefers the URL hash when it is a 0x value', () => {
		expect(
			extractHexParam('tx', {hash: `#${HASH}`, pathname: '/explorer/tx/'}),
		).toBe(HASH);
	});

	it('falls back to the pathname for the matching segment', () => {
		expect(
			extractHexParam('address', {
				hash: '',
				pathname: `/explorer/address/${ADDR}`,
			}),
		).toBe(ADDR);
	});

	it('returns null when neither matches', () => {
		expect(extractHexParam('tx', {hash: '', pathname: '/explorer'})).toBeNull();
		expect(
			extractHexParam('tx', {hash: '#notahex', pathname: '/explorer/tx/'}),
		).toBeNull();
	});

	it('does not match the wrong segment in the pathname', () => {
		expect(
			extractHexParam('tx', {hash: '', pathname: `/explorer/address/${ADDR}`}),
		).toBeNull();
	});
});

describe('createHexLocationParamStore', () => {
	it('follows the app-wide location stream, fragment included', () => {
		// The reason this store exists: on a path-based IPFS gateway the value
		// arrives in the FRAGMENT, which is not a route change, so a router-only
		// view of "where are we" would never see it.
		const browser = createFakeBrowser('https://app.test/explorer/tx/');
		const navigation = createNavigationService();
		navigation.attach(browser.driver);

		const txHash = createHexLocationParamStore(navigation, 'tx');
		expect(get(txHash)).toBeNull();

		browser.navigateTo(`https://app.test/explorer/tx/#${HASH}`);
		expect(get(txHash)).toBe(HASH);

		browser.navigateTo(`https://app.test/explorer/address/${ADDR}`);
		expect(get(txHash)).toBeNull();
	});

	it('reads as "nothing yet" before the app knows where it is', () => {
		// SSR, and the browser until hydration finishes: the service is inert by
		// design (ADR-0004, `work` branch), and the page shows its empty state.
		const navigation = createNavigationService();
		expect(get(createHexLocationParamStore(navigation, 'tx'))).toBeNull();
	});
});
