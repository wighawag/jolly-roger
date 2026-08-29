import {describe, it, expect, vi, afterEach} from 'vitest';
import {createPaymentRail} from '../../../../src/lib/core/connection/remote';
import type {ChainInfo} from '../../../../src/lib/deployments-store';

/**
 * `createPaymentRail` is an EXTENSION POINT PLACED UPSTREAM FOR A DESCENDANT.
 *
 * Nothing on this branch imports it. `with/local-signer` does
 * (`context/index.ts`), to sell credits over a second connection with its own
 * payer. Keeping it here rather than letting the variant fork
 * `establishRemoteConnection` is a deliberate and successful decision:
 * `remote.ts` has conflicted once in forty-four merges.
 *
 * The gap this closes: an extension point is only real if the branch that
 * OWNS it can tell when it breaks. Without this, a change to `remote.ts` here
 * leaves all of main's tests green and the failure surfaces during a cascade,
 * which is the worst possible moment to be debugging a connection factory.
 *
 * Deliberately a construction smoke test and nothing more: it builds, it
 * produces the three things its consumer destructures, it makes no eager
 * network call, and two rails are two rails. Testing what it does once
 * CONNECTED belongs on the branch that connects it.
 *
 * WHAT THIS DOES NOT COVER, measured rather than assumed. The rail's dormancy
 * (`autoConnect: false`) is NOT tested here: flipping it to `true` in
 * `createPaymentConnection` leaves all three cases below green. These run in
 * the `node` project, where `typeof window === 'undefined'`, so the connection
 * has no provider to auto-connect to and is inert whatever the flag says.
 * Recorded rather than quietly left out, because the comment on
 * `createPaymentRail` makes dormancy its central promise and a reader would
 * reasonably assume the test beside it holds that promise. It does not, and
 * holding it needs a browser-project test on the branch that connects.
 */

const chainInfo = {
	id: 31337,
	name: 'Anvil',
	nativeCurrency: {decimals: 18, name: 'Ether', symbol: 'ETH'},
	rpcUrls: {default: {http: []}},
	genesisHash:
		'0x5b206276f108cb545b45cc5661e73484b2fc5208d65f71d53d1de4df3b2e2a66',
	properties: {},
} as unknown as ChainInfo;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createPaymentRail (extension point for with/local-signer)', () => {
	it('constructs synchronously and hands back a connection and both clients', () => {
		const rail = createPaymentRail(chainInfo);

		// Exactly what `context/index.ts` on the descendant destructures.
		expect(rail.connection).toBeDefined();
		expect(rail.walletClient).toBeDefined();
		expect(rail.publicClient).toBeDefined();
		// A store, per ADR-0002: usable the moment it is built, readiness inside.
		expect(typeof rail.connection.subscribe).toBe('function');
	});

	it('makes no network call while being built', async () => {
		// Half of "constructing it talks to nobody": no eager HTTP. Verified to
		// fail by adding a `fetch()` call to createPaymentRail, which is the
		// regression it exists for. Building the rail up front instead of
		// deferring it (a bug this module already fixed once) is only safe for as
		// long as building it stays free.
		const fetchSpy = vi.fn(() => {
			throw new Error('the payment rail must not fetch during construction');
		});
		vi.stubGlobal('fetch', fetchSpy);

		const rail = createPaymentRail(chainInfo, {nodeURL: 'http://127.0.0.1:1'});
		// Let any accidentally-scheduled microtask work run.
		await Promise.resolve();

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(rail.connection).toBeDefined();
	});

	it('is a second, independent connection, not a handle on the app one', () => {
		// Two rails built from the same chain info must not BE the same object.
		// The descendant runs the payment connection alongside the app connection
		// and the two carry different wallets on purpose; anything that quietly
		// memoised or shared one connection would break that without a type error.
		const a = createPaymentRail(chainInfo);
		const b = createPaymentRail(chainInfo);
		expect(a.connection).not.toBe(b.connection);
		expect(a.walletClient).not.toBe(b.walletClient);
	});
});
