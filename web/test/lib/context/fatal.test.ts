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
// to pick up a different mocked env, which costs far more than the 5s default.
//
// A HANG GUARD, NOT A BUDGET, and the number reflects that. The first case pays
// for transforming the entire context graph in one go, and measured cold across
// the tree it runs in 6.5-15s with a long tail. The second case takes ~0.3s,
// because by then the graph is transformed; the whole cost is the first import.
//
// So: high enough that only a real hang trips it, and a real hang still fails
// the suite in two minutes rather than never. Raise it here rather than in a
// fork: this file is identical at every node, and a fork that edits it buys
// itself a conflict on every future alignment.
//
// DO NOT RAISE IT AGAIN. It went 30s -> 120s chasing a flake, and 120s was then
// blown too, by BOTH cases at once including the ~0.3s one - which is the tell,
// because no per-test budget explains a case that does no importing timing out
// beside the one that does. The cause was never this file: vitest defaults to a
// worker per core, each worker holding its own copy of a large module graph, so
// running three of these repos side by side put 48 forks into 8GB of free
// memory and the machine swapped. Everything got ~10x slower and the heaviest
// file was simply the first to hit a wall.
//
// The fix is `maxWorkers` in `vite.config.ts`, where the reasoning and the
// measurements are. If this times out again, look at what else is running
// before you touch this number.
const IMPORT_TIMEOUT = 120_000;

async function loadContextWith(env: Record<string, string>) {
	vi.resetModules();
	vi.doMock('$env/static/public', () => ({
		PUBLIC_NODE_URL: '',
		PUBLIC_CHAIN_INFO_NODE_URL: '',
		PUBLIC_WALLET_HOST: '',
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
