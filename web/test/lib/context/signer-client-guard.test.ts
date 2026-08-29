import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * THE SECOND TRACKED CLIENT HAS TO BE GUARDED, AND INSIDE THE MEMOISATION.
 *
 * This branch builds a client of its own for the local signer, which is a
 * different OBJECT from the one `lib/context` guards for the wallet. Unguarded,
 * every transaction the signer sends is dispatched with no in-flight record, so
 * a tab that dies between `eth_sendRawTransaction` leaving and the hash coming
 * back loses it: exactly the hole `core/transaction` closes for the account
 * executor, and invisible, because the transactions still go through. See
 * `core/transaction/README.md` and ADR-0004 (`work` branch).
 *
 * INSIDE the memoisation is the other half, and it is the subtle one.
 * `guardDispatch` returns a WRAPPER, so guarding the RESULT of
 * `buildSignerClient` at each call site hands out a fresh object every time,
 * which recreates the untracked-client bug `memoiseSignerClient` exists to
 * prevent: tracking identifies clients by reference, so the extra object is one
 * nobody listens to.
 *
 * A GUARD ABOUT ARRANGEMENT, not a unit test, in the shape of
 * `test/lib/core/ui/layers.test.ts` and `test/e2e-account-claims.test.ts`.
 * The behavioural version is not available from here: the signer client is
 * built lazily inside a `derived` over the connection store, and off-browser
 * that connection never leaves `Idle`, so nothing can make the executor produce
 * one. What CAN be checked is the arrangement, and both failure modes above are
 * arrangements. `createExecutor`'s DEV warning does not cover this either: it
 * inspects the wallet client it is handed and never the one `buildSignerClient`
 * returns, which was confirmed by probe (see
 * work/notes/findings/executor-dev-warning-does-not-see-the-signer-client.md).
 */

/**
 * The composition, wherever a descendant keeps it.
 *
 * Every `.ts` under `src/lib/context`, concatenated, rather than one named file.
 * `wallet-activity-boundary.test.ts` learned this the hard way when the rule
 * watched a FILE and a consumer moved to another one, and it happened again
 * here: `template-commit-reveal` splits the composition into `core.ts` (this
 * template's half) and `game.ts` (its own), leaving `index.ts` a few lines of
 * re-export. Pointed at `index.ts` this guard threw "no memoiseSignerClient
 * call" on a branch whose signer client is correctly guarded.
 *
 * The question is "is the signer client guarded inside the memoisation", and the
 * question does not care which file answers it.
 */
const CONTEXT_DIR = fileURLToPath(
	new URL('../../../src/lib/context/', import.meta.url),
);
const CONTEXT = readdirSync(CONTEXT_DIR)
	.filter((name) => name.endsWith('.ts'))
	.sort()
	.map((name) => readFileSync(join(CONTEXT_DIR, name), 'utf-8'))
	.join('\n');

/**
 * The body of the factory handed to `memoiseSignerClient`, by balancing
 * parentheses from the call. A regex cannot do this: the body contains nested
 * calls and object literals, so anything non-balanced either stops early or
 * swallows the rest of the file and makes the assertions vacuous.
 */
function memoisedFactoryBody(source: string): string {
	const start = source.indexOf('memoiseSignerClient(');
	if (start < 0)
		throw new Error('no memoiseSignerClient call anywhere in src/lib/context');
	let depth = 0;
	for (let i = start + 'memoiseSignerClient'.length; i < source.length; i++) {
		const char = source[i];
		if (char === '(') depth++;
		else if (char === ')') {
			depth--;
			if (depth === 0) return source.slice(start, i + 1);
		}
	}
	throw new Error('unbalanced memoiseSignerClient call');
}

describe('the local signer client', () => {
	const factory = memoisedFactoryBody(CONTEXT);

	it('is built inside the memoisation, so one key yields one object', () => {
		// Guards the guard: if this stopped finding the tracked-client
		// construction, every assertion below would be about the wrong text.
		expect(factory).toContain('trackerBuilder.using(');
	});

	it('is wrapped by guardDispatch', () => {
		expect(
			factory,
			'the signer client is dispatched with no in-flight record, so a reload ' +
				'between sending and receiving the hash loses the transaction',
		).toContain('guardDispatch(');
	});

	it('is wrapped INSIDE the memoisation, not around each use', () => {
		// The failure this catches: `guardDispatch(buildSignerClient(key).client)`
		// at a call site. That guards, and still loses transactions, because each
		// call produces another wrapper object and the tracking connector is
		// listening to a different one.
		const guardsOutside = [
			...CONTEXT.matchAll(/guardDispatch\(\s*buildSignerClient\b/g),
		];
		expect(
			guardsOutside.map((m) => m[0]),
			'guarding the RESULT of buildSignerClient makes a new wrapper per call',
		).toEqual([]);
	});

	it('guards every client the app builds, and only where it is built', () => {
		// One guard per client this app CONSTRUCTS, and no more. An extra would
		// mean something is being wrapped at a use site, which hands out a fresh
		// wrapper per call and recreates the untracked-client bug above.
		//
		// Three, and the third is the one that took longest to notice:
		//   1. the app wallet client (the authenticated account)
		//   2. the signer client, inside the memoisation (see above)
		//   3. the PAYMENT RAIL's wallet client, a second connection with its own
		//      payer, and the only one whose transactions the user paid for on
		//      purpose. It was unguarded until 2026-08-22 while both silent
		//      clients were covered, which is backwards: it needs a human at a
		//      wallet, so its window between signature and hash is the LONGEST.
		//
		// If this number changes, say which client and why, here.
		const guards = [...CONTEXT.matchAll(/guardDispatch\(/g)];
		expect(guards).toHaveLength(3);
	});
});
