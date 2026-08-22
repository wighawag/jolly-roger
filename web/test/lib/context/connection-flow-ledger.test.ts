import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
	createWalletActivity,
	inertActivityLedger,
} from '$lib/core/connection/wallet-activity';

/**
 * THE LEDGER BELONGS TO THE CONNECTION THAT SENDS.
 *
 * `$inFlight.dispatching` is app-wide: it counts every send the app has made and
 * has not had answered, wherever it went. A `ConnectionFlow` is per connection.
 * Wire the app-wide count into every flow and any flow beyond the first
 * announces "please confirm the request in your wallet" about a request that is
 * not its own.
 *
 * This app has ONE connection, so the rules below are currently satisfied by
 * arithmetic rather than by care, and that is precisely why they are written
 * down: the variant that adds a payment connection is where it bites, and it
 * did (two identical modals, and an escape hatch on the idle connection whose
 * `stopWaiting()` released the other connection's caller). See
 * work/notes/findings/one-ledger-two-connections-two-wallet-modals.md on the
 * `work` branch. A template's job is to make the second one inherit the answer.
 */
const IDLE_CONNECTION = {step: 'Idle' as const, wallet: undefined};

describe('a flow for a connection the app does not dispatch through', () => {
	it('says the wallet is idle even while the app is dispatching elsewhere', () => {
		const busyElsewhere = {
			subscribe: writable({dispatching: 1}).subscribe,
			reconcile: async () => {},
			stopAwaiting: () => {},
		};

		const owning = createWalletActivity({
			connection: writable(IDLE_CONNECTION),
			inFlight: busyElsewhere,
			cancelConnection: () => {},
		});
		const other = createWalletActivity({
			connection: writable(IDLE_CONNECTION),
			inFlight: inertActivityLedger(),
			cancelConnection: () => {},
		});

		// Guards the guard: with a busy ledger the prompt IS expected, so a change
		// that stopped prompting altogether would make the assertion below vacuous.
		expect(get(owning).promptUser).toBe(true);
		expect(get(other).promptUser).toBe(false);
		expect(get(other).escapable).toBe(false);
	});

	it('has an inert ledger whose actions are safe no-ops', async () => {
		const ledger = inertActivityLedger();
		expect(get(ledger)).toEqual({dispatching: 0});
		// Called by `stopWaitingForWallet` on every branch, so they must exist and
		// must not throw for a flow that has nothing to release.
		expect(() => ledger.stopAwaiting()).not.toThrow();
		await expect(ledger.reconcile()).resolves.toBeUndefined();
	});
});

describe('the app wiring', () => {
	const acrossPages = readFileSync(
		fileURLToPath(
			new URL('../../../src/lib/context/AcrossPages.svelte', import.meta.url),
		),
		'utf-8',
	);
	const flows = [...acrossPages.matchAll(/<ConnectionFlow\b[^/]*\/>/g)].map(
		(match) => match[0],
	);

	it('finds the connection flows it is talking about', () => {
		// Guards the guard: a rename or a reformat that split the tag across a
		// self-closing slash would make every rule below vacuously true.
		expect(flows.length).toBeGreaterThan(0);
	});

	it('gives the ledger to at most one of them', () => {
		const withLedger = flows.filter((flow) => /\binFlight\b/.test(flow));
		expect(
			withLedger.length,
			'every flow given the app-wide ledger claims the wallet is busy when ' +
				'any connection is, so at most one flow may have it: the one the app ' +
				'dispatches through',
		).toBeLessThanOrEqual(1);
	});

	it('names every flow, and never twice', () => {
		const names = flows.map((flow) => flow.match(/name="([^"]+)"/)?.[1]);
		expect(
			names.every((name) => !!name),
			`every flow needs an explicit name: ${flows.join(' ')}`,
		).toBe(true);
		expect(
			new Set(names).size,
			'an overlay label is its identity in the registry, so two flows sharing ' +
				'a name share one escape-hatch instance: opening the hatch on either ' +
				'renders the confirmation in both',
		).toBe(names.length);
	});
});
