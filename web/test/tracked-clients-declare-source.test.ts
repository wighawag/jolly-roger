import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/**
 * EVERY TRACKED CLIENT MUST SAY WHICH ROUTE IT SENDS FROM.
 *
 * A tracked client stamps `source` onto each transaction it broadcasts (see
 * core/connection/tx-source), and that stamp is the only durable record of
 * which key signed. Replacing or cancelling a stuck transaction reuses its
 * nonce, nonces are per-account, so without the stamp the app cannot work out
 * which route to reopen and the transaction becomes permanently unreplaceable.
 *
 * WHY A GREP AND NOT A TYPE. The type does force it, but only per client, and
 * the failure this guards is a whole client built somewhere else: `TSource`
 * defaults to `undefined`, so a second `createTrackedWalletClient(...)` written
 * without type arguments is perfectly legal, compiles, sends transactions
 * happily, and files every one of them with no route. Nothing fails. The user
 * finds out when they try to unstick a payment months later.
 *
 * IT COUNTS `.using(`, NOT `createTrackedWalletClient(`, and the difference is
 * the whole point. `source` is a BUILDER option and `.using()` is what turns a
 * builder into a client, so the unit that corresponds to "a signing route" is
 * `.using()`. `with/local-signer` today has ONE builder and THREE `.using()`
 * calls (the app wallet, the payment rail, the local signer), so a guard that
 * counted constructions would pass while two of its three clients stamped
 * `route: 'account'` on transactions the rail and the signer sent. That is
 * WORSE than no stamp: `selectSender` would confidently route a rail
 * transaction to the account executor, and the recovery would ask the user's
 * identity wallet for the payer's address.
 *
 * So the rule is ONE BUILDER PER ROUTE, and that branch has to split its single
 * builder when this merges down.
 *
 * THIS BRANCH HAS ONE CLIENT AND DOES NOT NEED THE CHECK. Its descendants do,
 * and a variant that adds a fourth client will not be reading this file when it
 * does. It lives here, where the rule lives, so the rule arrives with the code
 * rather than being re-derived downstream. Precisely the arrangement
 * `createPaymentRail` and `test/lib/core/connection/payment-rail.test.ts`
 * already use for an extension point owned upstream.
 *
 * A CI BACKSTOP, NOT A LOCAL ONE: `git ls-files` sees tracked files only, so a
 * brand-new client is invisible here until it is added, which is exactly while
 * it is being written.
 *
 * The same reasoning applies to `guardDispatch`, which core/connection/executor
 * warns about at runtime for the same class of mistake.
 */

const root = new URL('..', import.meta.url).pathname;

function sourceFiles(): string[] {
	// Tracked files only, so a stray scratch file cannot fail the suite.
	return execFileSync('git', ['ls-files', 'src'], {
		cwd: root,
		encoding: 'utf8',
	})
		.split('\n')
		.filter((path) => /\.(ts|svelte)$/.test(path));
}

/**
 * Every builder in a file, and whether it names a source.
 *
 * Deliberately crude: it reads the 400 characters following the call, which
 * comfortably covers an options object and cannot span to the next one. A
 * cleverer parse would be a second implementation of TypeScript, and the thing
 * being guarded is "somebody wrote a new one and did not think about it", which
 * a crude check catches exactly as well.
 */
function builders(text: string): {total: number; withSource: number} {
	const needle = 'createTrackedWalletClient';
	let total = 0;
	let withSource = 0;
	for (
		let at = text.indexOf(needle);
		at !== -1;
		at = text.indexOf(needle, at + 1)
	) {
		// Skip the import statement itself.
		const lineStart = text.lastIndexOf('\n', at) + 1;
		if (/^\s*import\b/.test(text.slice(lineStart, at))) continue;
		total++;
		if (text.slice(at, at + 400).includes('source:')) withSource++;
	}
	return {total, withSource};
}

/** How many clients this file turns those builders into. */
function clients(text: string): number {
	return text.split('.using(').length - 1;
}

describe('tracked clients declare their source', () => {
	const files = sourceFiles().map((path) => ({
		path,
		text: readFileSync(`${root}${path}`, 'utf8'),
	}));

	it('every builder passes a source', () => {
		const offenders = files
			.filter(({text}) => {
				const {total, withSource} = builders(text);
				return total > withSource;
			})
			.map(({path}) => path);

		expect(
			offenders,
			'A tracked client built without `source` files every transaction it ' +
				'sends with no signing route, so those transactions can never be ' +
				'resubmitted or cancelled. Pass `source` (a thunk, if the wallet or ' +
				'account behind the client can change) and register a matching Sender ' +
				'in the context. See core/connection/tx-source and senders.',
		).toEqual([]);
	});

	it('never turns one builder into several clients', () => {
		// ONE BUILDER PER ROUTE. `source` is fixed per builder, so a second
		// `.using()` on the same builder stamps the FIRST route onto a client that
		// is not on it. That is worse than an unstamped client: replacement would
		// route those transactions to the wrong executor with total confidence.
		const offenders = files
			.filter(({text}) => clients(text) > builders(text).total)
			.map(({path}) => path);

		expect(
			offenders,
			'This file turns one tracked-client builder into more than one client. ' +
				'A builder carries ONE `source`, so every client it makes claims the ' +
				'same signing route, and the ones that are on a different route are ' +
				'mislabelled rather than unlabelled. Build a separate ' +
				'createTrackedWalletClient per route.',
		).toEqual([]);
	});

	it('still finds the constructions it is meant to be checking', () => {
		// A guard that silently matches nothing passes forever. If the tracker is
		// renamed or the client moves, this fails and says so, rather than quietly
		// protecting an empty set.
		const total = files.reduce((sum, {text}) => sum + builders(text).total, 0);
		const made = files.reduce((sum, {text}) => sum + clients(text), 0);
		expect(total).toBeGreaterThan(0);
		expect(made).toBeGreaterThan(0);
	});
});
