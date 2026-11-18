import {describe, expect, it} from 'vitest';
import {appRoot} from '$lib/indexer/host';

describe("a worker's app root", () => {
	it('is where a built worker lives, under any path', () => {
		expect(
			appRoot('https://gw.example/ipfs/Qm/_app/immutable/workers/x-abc.js'),
		).toBe('https://gw.example/ipfs/Qm/');
		expect(appRoot('http://localhost:4173/_app/immutable/workers/x.js')).toBe(
			'http://localhost:4173/',
		);
	});

	it('is where Vite serves a worker from in development', () => {
		expect(
			appRoot('http://localhost:5173/src/lib/mygame/indexer.worker.ts?worker'),
		).toBe('http://localhost:5173/');
	});

	it('is refused for a URL it cannot read', () => {
		expect(() => appRoot('http://localhost:5173/worker.js')).toThrow(
			/cannot tell where the app is served from/,
		);
	});
});
