import {describe, it, expect} from 'vitest';
import {wouldDisturbForeignWorker} from '../../../../src/lib/core/service-worker/scope';

// A stand-in for the gateway's own worker, which sits at scope `/`.
const GATEWAY_SW = `https://bafy.ipfs.inbrowser.link/ipfs-sw-sw.js`;

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

	it('is true when a foreign worker sits at the same level as ours', () => {
		// subdomain service-worker gateway: registering would replace the
		// gateway's own registration outright
		expect(
			wouldDisturbForeignWorker(
				`https://bafy.ipfs.inbrowser.link/service-worker.js`,
				GATEWAY_SW,
			),
		).toBe(true);
	});

	it('is true when a foreign worker sits ABOVE ours', () => {
		// path-served service-worker gateway: our `/ipfs/bafy/` would be narrower
		// than the gateway's `/`, so nothing is replaced but longest-scope-match
		// silently hands control of the page to us
		expect(
			wouldDisturbForeignWorker(
				`https://gw.example/ipfs/bafy/service-worker.js`,
				`https://gw.example/ipfs-sw-sw.js`,
			),
		).toBe(true);
	});

	it('is true even when the script sits BELOW ours, because that says nothing about scope', () => {
		// The regression that a directory-comparing implementation ships. This is
		// the shape `ipfs-gateway-emulator --gateway sw` actually serves: a worker
		// script under `/ipfs-sw-emulator/` registered with `{scope: '/'}`. Judging
		// by the script's directory concludes "deeper than us, harmless" and
		// registers straight over a gateway that owns the whole origin.
		expect(
			wouldDisturbForeignWorker(
				`https://gw.example/service-worker.js`,
				`https://gw.example/ipfs-sw-emulator/sw.js`,
			),
		).toBe(true);
	});

	it('is true for a sibling directory, for the same reason', () => {
		expect(
			wouldDisturbForeignWorker(
				`https://example.com/app2/service-worker.js`,
				`https://example.com/app/their-sw.js`,
			),
		).toBe(true);
	});
});
