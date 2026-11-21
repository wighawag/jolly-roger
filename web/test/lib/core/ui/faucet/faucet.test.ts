import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {
	createFaucet,
	faucetConfigured,
} from '../../../../../src/lib/core/ui/faucet/faucet';

/**
 * The faucet as a capability, as the block explorer is one (P1-3): the app
 * composes it from its configuration (`$lib/index.ts`) and provides it at the
 * root, so `core/ui/faucet` reads neither the environment nor the deployments
 * and a copy of it runs in an app that configures its faucet another way.
 */
describe('createFaucet', () => {
	it('reads its configuration at each call, not at construction', () => {
		let api: string | undefined = undefined;
		const faucet = createFaucet({api: () => api, link: () => ''});
		expect(faucet.api()).toBeUndefined();
		api = 'https://faucet.example';
		expect(faucet.api()).toBe('https://faucet.example');
	});

	it('treats a blank value as no value', () => {
		const faucet = createFaucet({api: () => '  ', link: () => ''});
		expect(faucet.api()).toBeUndefined();
		expect(faucet.link()).toBeUndefined();
	});
});

describe('faucetConfigured', () => {
	it('is false with no faucet, or one with neither an api nor a link', () => {
		expect(faucetConfigured(undefined)).toBe(false);
		expect(
			faucetConfigured(createFaucet({api: () => '', link: () => undefined})),
		).toBe(false);
	});

	it('is true with an api or a link', () => {
		expect(
			faucetConfigured(createFaucet({api: () => '//:34010', link: () => ''})),
		).toBe(true);
		expect(
			faucetConfigured(
				createFaucet({api: () => '', link: () => 'https://faucet.example'}),
			),
		).toBe(true);
	});
});

describe('core/ui/faucet', () => {
	// The point of the capability, asserted on the files: a module-level read of
	// the environment or of the deployments store is what tied this folder to
	// jolly-roger's composition.
	const dir = new URL('../../../../../src/lib/core/ui/faucet/', import.meta.url)
		.pathname;
	const files = readdirSync(dir).filter((name) => /\.(ts|svelte)$/.test(name));

	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('imports neither $env nor the deployments store', () => {
		const offenders = files.filter((name) =>
			/from\s+['"](\$env\/|\$lib\/deployments-store)/.test(
				readFileSync(join(dir, name), 'utf8'),
			),
		);
		expect(offenders).toEqual([]);
	});
});
