import {describe, it, expect} from 'vitest';
import {
	isSameHostURL,
	resolveSameHostURL,
	resolveURLForThisPage,
} from '$lib/core/env/same-host';

const page = {protocol: 'http:', hostname: '192.168.1.42'};

describe('a service url that follows the page', () => {
	it('takes the page\u2019s host, keeping the port', () => {
		// The case it exists for: the dev server is opened from a phone on the
		// LAN, and `localhost:8545` on the phone is the phone.
		expect(resolveSameHostURL('//:8545', page)).toBe(
			'http://192.168.1.42:8545',
		);
	});

	it('takes the page\u2019s scheme too, which is what a tunnel needs', () => {
		// A page served over https must not reach for an http service: the
		// browser refuses it as mixed content, and the error names neither the
		// `.env` nor this module.
		expect(
			resolveSameHostURL('//:8545', {
				protocol: 'https:',
				hostname: 'x.trycloudflare.com',
			}),
		).toBe('https://x.trycloudflare.com:8545');
	});

	it('lets an explicit scheme override the page\u2019s', () => {
		expect(
			resolveSameHostURL('http://:8545', {
				protocol: 'https:',
				hostname: 'host',
			}),
		).toBe('http://host:8545');
	});

	it('keeps a path, and allows no port at all', () => {
		expect(resolveSameHostURL('//:8545/rpc', page)).toBe(
			'http://192.168.1.42:8545/rpc',
		);
		expect(resolveSameHostURL('//:/api', page)).toBe('http://192.168.1.42/api');
	});

	it('leaves an ordinary url exactly as it is', () => {
		// Which is every value in every existing .env in this tree: adopting the
		// notation changes nothing until somebody opts in.
		for (const url of [
			'http://localhost:8545',
			'https://rpc.example.com',
			'http://127.0.0.1:8545/path?q=1',
		]) {
			expect(resolveSameHostURL(url, page)).toBe(url);
		}
	});

	it('answers undefined for an empty value, as callers already expect', () => {
		expect(resolveSameHostURL(undefined, page)).toBe(undefined);
		expect(resolveSameHostURL('   ', page)).toBe(undefined);
	});

	it('answers undefined with no page, rather than guessing a host', () => {
		// This is the prerender case (ADR-0002). "No url" is a state every
		// consumer already supports - the app reads the chain through the user's
		// wallet - so nothing has to learn a new one, and the browser resolves
		// it for real on the first render.
		expect(resolveSameHostURL('//:8545', undefined)).toBe(undefined);
		expect(
			resolveSameHostURL('//:8545', {protocol: 'http:', hostname: ''}),
		).toBe(undefined);
		// An ordinary url still resolves with no page: it needs nothing.
		expect(resolveSameHostURL('http://localhost:8545', undefined)).toBe(
			'http://localhost:8545',
		);
	});

	it('recognises the notation, so a caller can report it', () => {
		expect(isSameHostURL('//:8545')).toBe(true);
		expect(isSameHostURL('ws://:8546')).toBe(true);
		expect(isSameHostURL('http://localhost:8545')).toBe(false);
		expect(isSameHostURL(undefined)).toBe(false);
	});

	it('cannot be mistaken for a usable url if it is never resolved', () => {
		// The reason the notation is an empty authority rather than a
		// placeholder host: anything that reaches a URL parser with one of these
		// still in it fails loudly, instead of resolving DNS, timing out, and
		// looking like the service being down.
		expect(() => new URL('http://:8545')).toThrow();
		expect(() => new URL('//:8545')).toThrow();
	});

	it('resolves against no window in this environment', () => {
		// The server project has no `window`, which is the same environment the
		// prerender runs in.
		expect(resolveURLForThisPage('//:8545')).toBe(undefined);
		expect(resolveURLForThisPage('http://localhost:8545')).toBe(
			'http://localhost:8545',
		);
	});
});
