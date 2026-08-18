import {describe, it, expect} from 'vitest';
import {
	defaultScopeOf,
	wouldDisturbForeignWorker,
} from '../../../../src/lib/core/service-worker/scope';

// A stand-in for the gateway's own worker, which sits at scope `/`.
const GATEWAY_SW = `https://bafy.ipfs.inbrowser.link/ipfs-sw-sw.js`;

describe('defaultScopeOf', () => {
	it("is the script's directory", () => {
		expect(defaultScopeOf(`https://example.com/service-worker.js`)).toBe(
			`https://example.com/`,
		);
		expect(defaultScopeOf(`https://example.com/app/service-worker.js`)).toBe(
			`https://example.com/app/`,
		);
	});

	it('always ends in a slash, which the prefix test depends on', () => {
		expect(defaultScopeOf(`https://example.com/a/b/sw.js`).endsWith(`/`)).toBe(
			true,
		);
	});
});

describe('wouldDisturbForeignWorker', () => {
	it('is false when the page is not controlled', () => {
		// first visit: nothing to disturb, register normally
		expect(
			wouldDisturbForeignWorker(`https://example.com/service-worker.js`, null),
		).toBe(false);
		expect(
			wouldDisturbForeignWorker(
				`https://example.com/service-worker.js`,
				undefined,
			),
		).toBe(false);
	});

	it('is false when the controller is our own worker', () => {
		// repeat visit: re-register to keep the update flow alive
		const swURL = `https://example.com/service-worker.js`;
		expect(wouldDisturbForeignWorker(swURL, swURL)).toBe(false);
	});

	it('is false when our own worker is reached by a different route', () => {
		// path gateway on a deep route: `resolve()` yields `../service-worker.js`,
		// which must still be recognised as ours once made absolute
		const swURL = `https://gw.example/ipfs/bafy/service-worker.js`;
		expect(wouldDisturbForeignWorker(swURL, swURL)).toBe(false);
	});

	it('is true when a foreign worker holds the SAME scope', () => {
		// subdomain service-worker gateway: registering replaces the gateway's own
		// registration outright
		expect(
			wouldDisturbForeignWorker(
				`https://bafy.ipfs.inbrowser.link/service-worker.js`,
				GATEWAY_SW,
			),
		).toBe(true);
	});

	it('is true when a foreign worker holds an ANCESTOR scope', () => {
		// path-served service-worker gateway: our scope `/ipfs/bafy/` is NARROWER
		// than the gateway's `/`, so nothing is replaced but longest-scope-match
		// silently hands control of the page to us. This is the regression an
		// equality-only test does not catch.
		expect(
			wouldDisturbForeignWorker(
				`https://gw.example/ipfs/bafy/service-worker.js`,
				`https://gw.example/ipfs-sw-sw.js`,
			),
		).toBe(true);
	});

	it('is false when a foreign worker is scoped DEEPER than us', () => {
		// it keeps its own subtree by longest-match, we cannot displace it
		expect(
			wouldDisturbForeignWorker(
				`https://example.com/service-worker.js`,
				`https://example.com/embed/their-sw.js`,
			),
		).toBe(false);
	});

	it('does not treat a sibling directory as an ancestor', () => {
		// `/app/` must not prefix-match `/app2/`
		expect(
			wouldDisturbForeignWorker(
				`https://example.com/app2/service-worker.js`,
				`https://example.com/app/their-sw.js`,
			),
		).toBe(false);
	});
});
