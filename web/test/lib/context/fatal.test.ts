import {describe, it, expect, vi, afterEach} from 'vitest';
import {get} from 'svelte/store';

// The two fatal reasons differ in WHEN they are raised, and that timing is
// forced by hydration (ADR-0002):
//
//   env-derived    -> at construction, identical on server and client, so the
//                     error screen prerenders and hydrates without a mismatch
//   param-derived  -> in start(), because the URL is empty on the server, so
//                     raising it at construction would make the browser's
//                     first render disagree with the prerendered HTML
//
// `$env/static/public` is inlined at build time, so the env case is exercised
// by mocking the module rather than by setting process.env.

afterEach(() => {
	vi.resetModules();
	vi.unstubAllGlobals();
	vi.doUnmock('$env/static/public');
	vi.doUnmock('$lib');
});

// Each case re-imports the context module (and with it the whole app barrel)
// to pick up a different mocked env, which costs more than the 5s default.
const IMPORT_TIMEOUT = 30_000;

async function loadContextWith(env: Record<string, string>) {
	vi.resetModules();
	vi.doMock('$env/static/public', () => ({
		PUBLIC_NODE_URL: '',
		PUBLIC_WALLET_HOST: '',
		PUBLIC_EXECUTION_MODE: '',
		PUBLIC_USE_BURNER_WALLET: '',
		PUBLIC_OPERATION_RETENTION_DAYS: '',
		PUBLIC_ENS_NODE_URL: '',
		PUBLIC_ENABLE_SW_IN_DEV: '',
		...env,
	}));
	return (await import('$lib/context/index')).createContext;
}

describe('fatal', () => {
	it(
		'is unset for a valid configuration',
		async () => {
			const createContext = await loadContextWith({});
			const {context} = createContext();
			expect(get(context.fatal)).toBe(undefined);
		},
		IMPORT_TIMEOUT,
	);

	it(
		'is set at construction for an illegal env combination',
		async () => {
			// signer execution requires hosted sign-in (PUBLIC_WALLET_HOST).
			const createContext = await loadContextWith({
				PUBLIC_EXECUTION_MODE: 'signer',
			});
			const {context} = createContext();

			// Known before anything mounts, so the error screen prerenders.
			expect(get(context.fatal)).toEqual(expect.any(String));
		},
		IMPORT_TIMEOUT,
	);

	it(
		'holds the burner failure back until start()',
		async () => {
			vi.resetModules();
			// `?burner=true` that cannot be honoured: no node URL to point it at.
			vi.doMock('$lib', async () => ({
				...(await vi.importActual<Record<string, unknown>>('$lib')),
				burnerOverride: true,
			}));
			const createContext = await loadContextWith({});
			const {context, start} = createContext();

			// Construction stays quiet: the server cannot see the query param, so
			// raising it here would break hydration.
			expect(get(context.fatal)).toBe(undefined);

			// start() is the browser phase, so give it the bits it touches.
			vi.stubGlobal('window', {
				addEventListener: () => {},
				removeEventListener: () => {},
			});
			const stop = start();
			expect(get(context.fatal)).toEqual(expect.any(String));
			stop();
		},
		IMPORT_TIMEOUT,
	);
});
