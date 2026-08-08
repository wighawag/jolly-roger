import {describe, it, expect, vi, afterEach} from 'vitest';
import {get} from 'svelte/store';
import {TARGET_STEP} from '$lib/core/connection/mode';

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
		PUBLIC_CHAIN_INFO_NODE_URL: '',
		PUBLIC_WALLET_HOST: '',
		PUBLIC_USE_BURNER_WALLET: '',
		PUBLIC_OPERATION_RETENTION_DAYS: '',
		PUBLIC_ENS_NODE_URL: '',
		PUBLIC_ENABLE_SW_IN_DEV: '',
		PUBLIC_FAUCET_LINK: '',
		PUBLIC_FAUCET_API: '',
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

	// Only meaningful when this app signs in. With TARGET_STEP set to
	// 'WalletConnected' there is no signer, nothing needs an RPC of its own, and
	// there is no such fatal to assert. Guarded explicitly rather than left to
	// pass vacuously, so flipping the constant does not quietly drop coverage.
	it.runIf(TARGET_STEP === 'SignedIn')(
		'is set at construction when hosted sign-in has no RPC to broadcast through',
		async () => {
			// Hosted sign-in can authenticate an account with NO wallet (email,
			// social), and the local signer then has nothing to fall back to, so an
			// app RPC stops being optional.
			const createContext = await loadContextWith({
				PUBLIC_WALLET_HOST: 'https://wallet.example',
				PUBLIC_NODE_URL: '',
			});
			const {context} = createContext();

			// Known before anything mounts, so the error screen prerenders.
			expect(get(context.fatal)).toEqual(expect.any(String));
		},
		IMPORT_TIMEOUT,
	);

	it.runIf(TARGET_STEP === 'SignedIn')(
		'is unset for wallet-only sign-in with no RPC',
		async () => {
			// The default shape of this template: signs in (so there is a signer),
			// no hosted service, nothing configured. Every account here arrived
			// through a wallet, so the signer can broadcast through it, and refusing
			// to start would make a fresh clone show an error screen for a problem
			// it does not have.
			const createContext = await loadContextWith({
				PUBLIC_WALLET_HOST: '',
				PUBLIC_NODE_URL: '',
			});
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
