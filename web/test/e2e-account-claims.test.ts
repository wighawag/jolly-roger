import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Every e2e file that sends transactions needs an account of its own.
 *
 * Files run in parallel workers, so two of them sending from one account race
 * for the same nonce, and that surfaces as an unrelated test failing on a
 * transaction that never appeared. The claims live in each file, as
 * `test.use({walletAccountIndex: N})`, and used to be tracked by a comment in
 * scripts/run-e2e-tests.sh, which cannot be wrong out loud.
 *
 * This is that comment, executable. It reads the suite rather than a list, so a
 * new file claiming a taken index, or one beyond the configured accounts, fails
 * here instead of somewhere unrelated twenty minutes into a run.
 */
const E2E_DIR = new URL('../e2e/tests/', import.meta.url).pathname;
const ACCOUNTS = JSON.parse(
	readFileSync(
		new URL('../e2e/impersonate-addresses.json', import.meta.url),
		'utf8',
	),
) as string[];

/** `test.use({walletAccountIndex: 2})`, or the default of 0 when absent. */
function claimedIndex(source: string): number {
	const match = source.match(/walletAccountIndex:\s*(\d+)/);
	return match ? Number(match[1]) : 0;
}

/** A file that submits a transaction: it either connects a wallet or sends one. */
function sendsTransactions(source: string): boolean {
	return /connectedPage|submitGreeting|connectWallet/.test(source);
}

describe('e2e wallet account claims', () => {
	const files = readdirSync(E2E_DIR)
		.filter((name) => name.endsWith('.e2e.ts'))
		.map((name) => ({name, source: readFileSync(join(E2E_DIR, name), 'utf8')}))
		.filter(({source}) => sendsTransactions(source));

	it('finds the transaction-sending suites', () => {
		// Guards the guard: a rename that broke the detection above would make
		// every assertion below vacuously true.
		expect(files.length).toBeGreaterThan(0);
	});

	it('gives each of them a distinct account', () => {
		const byIndex = new Map<number, string[]>();
		for (const {name, source} of files) {
			const index = claimedIndex(source);
			byIndex.set(index, [...(byIndex.get(index) ?? []), name]);
		}

		const shared = [...byIndex.entries()].filter(
			([, names]) => names.length > 1,
		);
		expect(
			shared,
			`these suites share a burner account and will race for its nonce: ${shared
				.map(([index, names]) => `index ${index}: ${names.join(', ')}`)
				.join('; ')}. Give one of them its own index and add an address to ` +
				`web/e2e/impersonate-addresses.json.`,
		).toEqual([]);
	});

	it('keeps every claim within the configured accounts', () => {
		for (const {name, source} of files) {
			const index = claimedIndex(source);
			expect(
				index,
				`${name} claims account ${index}, but only ${ACCOUNTS.length} are configured`,
			).toBeLessThan(ACCOUNTS.length);
		}
	});
});

/**
 * The stalling wallet is a SECOND account pool, with its own claims.
 *
 * It sends real transactions from addresses of its own rather than burner ones,
 * so the rule above cannot see it: `walletAccountIndex` says nothing about it.
 * The same hazard applies though: two suites signing as one address race for its
 * nonce, and that surfaces as an unrelated test failing on a transaction that
 * never appeared.
 *
 * The claim is `installStallingWallet(page, {..., stallingAccountIndex: N})`,
 * read from the call site the same way `walletAccountIndex` is, so it cannot be
 * wrong out loud. It was "exactly one suite may use this fixture" while the pool
 * held one address; the second suite that needed the dispatch window is what
 * turned that into a pool.
 */
describe('e2e stalling-wallet accounts', () => {
	const FIXTURE = readFileSync(
		new URL('../e2e/fixtures/stalling-wallet.ts', import.meta.url),
		'utf8',
	);
	const pool =
		FIXTURE.match(/STALLING_WALLET_ACCOUNTS = \[([\s\S]*?)\]/)?.[1] ?? '';
	const accounts = [...pool.matchAll(/'(0x[0-9a-fA-F]{40})'/g)].map(
		(match) => match[1],
	);

	/** `stallingAccountIndex: 1`, or the default of 0 when absent. */
	function claimedStallingIndex(source: string): number {
		const match = source.match(/stallingAccountIndex:\s*(\d+)/);
		return match ? Number(match[1]) : 0;
	}

	const users = readdirSync(E2E_DIR)
		.filter((name) => name.endsWith('.e2e.ts'))
		.map((name) => ({name, source: readFileSync(join(E2E_DIR, name), 'utf8')}))
		.filter(({source}) => source.includes('stalling-wallet'));

	it('declares addresses the test can find', () => {
		// Guards the guard: a rename here would make every assertion below vacuous.
		expect(
			accounts.length,
			'STALLING_WALLET_ACCOUNTS should be literal addresses',
		).toBeGreaterThan(0);
		expect(users.length).toBeGreaterThan(0);
	});

	it('stays clear of the accounts the burner offers', () => {
		const clash = accounts.filter((account) =>
			ACCOUNTS.some((a) => a.toLowerCase() === account.toLowerCase()),
		);
		expect(
			clash,
			`the stalling wallet signs as ${clash.join(', ')}, which is also in ` +
				`e2e/impersonate-addresses.json. It would then race a burner suite for ` +
				`that account's nonce. Give it addresses nothing else uses.`,
		).toEqual([]);
	});

	it('never signs as the same address twice', () => {
		const lowered = accounts.map((a) => a.toLowerCase());
		expect(new Set(lowered).size, `duplicate in ${accounts.join(', ')}`).toBe(
			accounts.length,
		);
	});

	it('gives each driving suite an account of its own', () => {
		const byIndex = new Map<number, string[]>();
		for (const {name, source} of users) {
			const index = claimedStallingIndex(source);
			byIndex.set(index, [...(byIndex.get(index) ?? []), name]);
		}

		const shared = [...byIndex.entries()].filter(
			([, names]) => names.length > 1,
		);
		expect(
			shared,
			`these suites drive the stalling wallet as the same address, so they ` +
				`will race for its nonce under fullyParallel: ${shared
					.map(([index, names]) => `index ${index}: ${names.join(', ')}`)
					.join(
						'; ',
					)}. Pass a free stallingAccountIndex, adding an address to ` +
				`STALLING_WALLET_ACCOUNTS if none is left.`,
		).toEqual([]);
	});

	it('keeps every claim within the pool', () => {
		for (const {name, source} of users) {
			const index = claimedStallingIndex(source);
			expect(
				index,
				`${name} claims stalling account ${index}, but only ${accounts.length} are configured`,
			).toBeLessThan(accounts.length);
		}
	});
});
