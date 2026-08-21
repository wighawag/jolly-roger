import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/**
 * "What is the wallet holding" gets ONE answer, and this is what makes that
 * true rather than merely stated.
 *
 * `wallet-activity.ts` exists because five consumers each combined the same
 * three sources (the connection library's pending requests, the app's own
 * dispatch count, and the requests the user gave up on) and drifted apart. The
 * drift produced the same bug twice: a control offering an exit on one reading
 * while the code behind it took a narrower one, and cancelled a connection with
 * a transaction in flight.
 *
 * The primitives stay exported because they are pure, carefully worded, and
 * worth testing one at a time. But a rule nothing checks is a wish, which is
 * exactly what `framework-boundary.test.ts` says about the `$app/*` rule next
 * door. So: app code goes through `createWalletActivity`, and this fails if
 * anything else reaches past it.
 *
 * Tests are exempt, deliberately: checking a predicate directly is the point of
 * having it. `wallet-activity.ts` itself is exempt because it is the one place
 * allowed to combine them.
 */
/**
 * ALLOWED, rather than a list of what is forbidden. A forbidden-list is open by
 * default: add a seventh primitive and it is unguarded until someone remembers
 * to name it here. This way a new export is guarded the moment it exists, and
 * the list grows only when someone deliberately widens the sanctioned surface.
 */
const SANCTIONED = [
	'createWalletActivity',
	'WalletActivity',
	'WalletActivityStore',
];

/**
 * Predicates that combine the same sources by hand, wherever they live.
 *
 * `canDismissConnection` was the fifth consumer and it stayed behind in
 * `connection-flow.ts`, so a rule that only watched imports OF wallet-activity
 * could not see it, and it was wired straight to `connection.cancel()`. The rule
 * has to follow the question, not the file it happens to sit in.
 */
const HAND_COMBINERS = ['canDismissConnection', 'hasPendingWalletRequest'];

const OWNER = 'src/lib/core/connection/wallet-activity.ts';

const root = new URL('..', import.meta.url).pathname;

function sourceFiles(): string[] {
	// Tracked files only, so a stray scratch file cannot fail the suite.
	return execFileSync('git', ['ls-files', 'src'], {cwd: root, encoding: 'utf8'})
		.split('\n')
		.filter((path) => /\.(ts|svelte)$/.test(path))
		.filter((path) => path !== OWNER);
}

/**
 * Names a file imports from `module`, however the clause is written.
 *
 * Both quote styles, because the repo contains both (`src/lib/shadcn/**` uses
 * double), and a namespace import reported as `*`, because
 * `import * as wa from './wallet-activity'` reaches everything while naming
 * nothing.
 */
function importedFrom(source: string, module: string): string[] {
	const names: string[] = [];
	const quoted = `['"][^'"]*${module}['"]`;

	if (
		new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s*${quoted}`).test(source)
	) {
		names.push('*');
	}

	const clause = new RegExp(
		`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*${quoted}`,
		'g',
	);
	let match: RegExpExecArray | null;
	while ((match = clause.exec(source)) !== null) {
		for (const part of match[1].split(',')) {
			const name = part
				.trim()
				.replace(/^type\s+/, '')
				.split(/\s+as\s+/)[0];
			if (name) names.push(name);
		}
	}
	return names;
}

describe('one answer about the wallet', () => {
	it('finds the module it is guarding', () => {
		// Guards the guard: a rename would make every assertion below vacuous.
		expect(() => readFileSync(`${root}${OWNER}`, 'utf8')).not.toThrow();
		expect(readFileSync(`${root}${OWNER}`, 'utf8')).toContain(
			'export function createWalletActivity',
		);
	});

	it('is looking at a real file list', () => {
		// The safeguard `framework-boundary.test.ts` has and the first version of
		// this file dropped: with a wrong cwd `git ls-files` returns nothing,
		// `offenders` is empty, and the whole rule passes vacuously.
		expect(sourceFiles().length).toBeGreaterThan(50);
	});

	it('sees what a file imports, not merely that it mentions a word', () => {
		// Guards the guard: a detector that matched anywhere in the file flagged a
		// file whose only import was `createWalletActivity`.
		expect(
			importedFrom(
				"import {createWalletActivity} from './wallet-activity';\n" +
					'// mentions offersEscapeHatch in prose\n',
				'wallet-activity',
			),
		).toEqual(['createWalletActivity']);
		expect(
			importedFrom(
				"import {\n\toffersEscapeHatch,\n\ttype WalletActivity,\n} from '$lib/core/connection/wallet-activity';",
				'wallet-activity',
			),
		).toEqual(['offersEscapeHatch', 'WalletActivity']);
		// Double quotes, which the shadcn tree uses.
		expect(
			importedFrom(
				'import {offersEscapeHatch} from "./wallet-activity";',
				'wallet-activity',
			),
		).toEqual(['offersEscapeHatch']);
		// A namespace import names nothing and reaches everything.
		expect(
			importedFrom(
				"import * as wa from './wallet-activity';",
				'wallet-activity',
			),
		).toEqual(['*']);
	});

	it('routes app code through createWalletActivity', () => {
		const offenders = sourceFiles().filter((path) => {
			const names = importedFrom(
				readFileSync(`${root}${path}`, 'utf8'),
				'wallet-activity',
			);
			return names.some((name) => !SANCTIONED.includes(name));
		});

		expect(
			offenders,
			`these files reach past createWalletActivity for a primitive: ` +
				`${offenders.join(', ')}. Combining the sources per consumer is what ` +
				`produced the disconnect-with-a-transaction-in-flight bug twice. Read ` +
				`the derived value instead, and if it does not answer your question, ` +
				`add a field to it so every consumer gets the same answer.`,
		).toEqual([]);
	});

	it('does not let the hand-combining predicates back in another door', () => {
		const offenders = sourceFiles().filter((path) => {
			const names = importedFrom(
				readFileSync(`${root}${path}`, 'utf8'),
				'connection-flow',
			);
			return names.some((name) => HAND_COMBINERS.includes(name));
		});

		expect(
			offenders,
			`these files ask whether the wallet is busy without going through ` +
				`createWalletActivity: ${offenders.join(', ')}. ${HAND_COMBINERS.join(
					' and ',
				)} read only the connection library's request list, which a wallet ` +
				`state rebuild empties while a transaction is still outstanding.`,
		).toEqual([]);
	});
});
