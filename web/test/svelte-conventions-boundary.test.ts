import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/**
 * Two of AGENTS.md's Svelte conventions are absolute, so they are cheap to
 * check and there is no reason to leave them to review:
 *
 *   - never create `.svelte.ts` files
 *   - never use runes (`$state`, `$derived`, `$effect`, ...) outside `.svelte`
 *
 * Both hold today. This exists so they keep holding, and because a rule
 * nothing checks is a wish, which is what `framework-boundary.test.ts` and
 * `wallet-activity-boundary.test.ts` next door both say about themselves.
 *
 * The third convention, "`.svelte` files must be logic-less or logic-minimal",
 * is deliberately NOT checked. It is about the KIND of code, not its size, and
 * every mechanical proxy for it (line counts, statement counts) fires on the
 * wrong things and teaches people to game the number. That one stays with
 * review, where judgement is available.
 *
 * `src/lib/shadcn/**` is exempt: it is vendored, we do not write it, and
 * upstream's conventions are upstream's business.
 */

const root = new URL('..', import.meta.url).pathname;

/** Tracked files only, so a stray scratch file cannot fail the suite. */
function trackedFiles(): string[] {
	return execFileSync('git', ['ls-files', 'src', 'test', 'e2e'], {
		cwd: root,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean)
		.filter((path) => !path.startsWith('src/lib/shadcn/'));
}

/**
 * Strip comments and string literals before looking for runes.
 *
 * This is the whole difficulty of the rule, and skipping it makes the test
 * WORSE than nothing. `core/ui/overlay/registry.ts` and `overlay/define.ts`
 * both contain the text `$effect(() => overlay.registerRenderer())`, one in a
 * doc comment and one inside a console warning, because they are documenting
 * how a COMPONENT should call them. Documentation that explains the boundary
 * is the last thing a boundary test should punish: a rule that fires on
 * comments teaches people to stop writing comments.
 *
 * Crude on purpose (it does not parse), and that is safe in the direction that
 * matters: over-stripping can only ever cause a false PASS, never a false
 * failure, and the detector tests below pin the cases that matter.
 */
function stripCommentsAndStrings(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
		.replace(/`(?:\\.|[^`\\])*`/g, '``')
		.replace(/'(?:\\.|[^'\\\n])*'/g, "''")
		.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/**
 * A rune is always INVOKED, either directly (`$state(0)`, `$props()`) or
 * through a member (`$state.raw(0)`, `$derived.by(...)`, `$effect.pre(...)`).
 * Requiring the `(` or the `.` is what separates the rune from a variable that
 * merely shares its name, and there is one in the tree: `rpcHealth.ts:164`
 * declares `let $state: RpcHealthValue`, the old convention for naming a
 * snapshot of a store's value. That is legal in a `.ts` file, where runes do
 * not exist, and a first version of this test failed on it.
 */
const RUNE_NAMES = [
	'state',
	'derived',
	'effect',
	'props',
	'bindable',
	'inspect',
	'host',
] as const;

const RUNE = new RegExp(
	`(?<![.\\w$])\\$(?:${RUNE_NAMES.join('|')})\\s*[.(]`,
);

/**
 * Names the file DECLARES as ordinary bindings, which are therefore not runes.
 *
 * The invocation rule alone is not enough, and a descendant proved it. A local
 * called `$state` read as `$state.step` is indistinguishable by shape from the
 * member rune `$state.raw(0)`: both are the name, a dot, and a word. Requiring
 * the `.` catches the second and cannot help matching the first.
 *
 * A declaration settles it, because Svelte will not let you declare a rune. So
 * `let $state = ...` in a `.ts` file proves every `$state` in that file is the
 * variable, and this is the same old store-snapshot convention that
 * `rpcHealth.ts` uses. Scoped per file and per name: declaring `$state` says
 * nothing about `$effect` in the same file.
 */
function declaredNames(source: string): Set<string> {
	const out = new Set<string>();
	for (const name of RUNE_NAMES) {
		const declaration = new RegExp(
			`(?:^|[^.\\w$])(?:let|const|var)\\s+\\$${name}\\b`,
		);
		if (declaration.test(source)) out.add(name);
	}
	return out;
}

function usesRunes(source: string): boolean {
	const code = stripCommentsAndStrings(source);
	const declared = declaredNames(code);
	return RUNE_NAMES.some((name) => {
		if (declared.has(name)) return false;
		return new RegExp(`(?<![.\\w$])\\$${name}\\s*[.(]`).test(code);
	});
}

describe('Svelte conventions', () => {
	it('is looking at a real file list', () => {
		// Guards the guard: with a wrong cwd `git ls-files` returns nothing and
		// every assertion below passes vacuously.
		//
		// Deliberately NOT a file count. This rule is inherited by descendants of
		// this template that range from a couple of dozen files to several
		// hundred, so any threshold is meaningless at one end or wrong at the
		// other. Assert instead that the scan reached the two things the rules are
		// ABOUT: some `.svelte` components (which is where runes are allowed) and
		// some `.ts` modules (which is where they are not).
		const files = trackedFiles();
		expect(files.some((p) => p.endsWith('.svelte'))).toBe(true);
		expect(files.some((p) => p.endsWith('.ts'))).toBe(true);
	});

	it('strips comments and strings before looking for a rune', () => {
		// Guards the guard, with the two real files that would otherwise be
		// flagged. Verified against the tree: both of these are live text in
		// `src/lib/core/ui/overlay/`.
		expect(
			usesRunes('// the usual call site is `$effect(() => overlay.register())`'),
		).toBe(false);
		expect(
			usesRunes('/**\n * $derived(...) is how a component would read this.\n */'),
		).toBe(false);
		expect(usesRunes("console.warn('(usually $effect(() => x())).');")).toBe(
			false,
		);
		// And still sees the real thing.
		expect(usesRunes('let open = $state(false);')).toBe(true);
		expect(usesRunes('const view = $derived(compute($store));')).toBe(true);
		// Member-invoked runes still count.
		expect(usesRunes('let rows = $state.raw([]);')).toBe(true);
		expect(usesRunes('$effect.pre(() => {});')).toBe(true);
		// A property or an identifier that merely ends in the same letters is not
		// a rune. `foo.$state` and `my$state` are not what the rule is about.
		expect(usesRunes('thing.$state(1);')).toBe(false);
		expect(usesRunes('const my$state = 1;')).toBe(false);
		// A VARIABLE named after a rune is not a rune. This exact shape is live in
		// src/lib/core/connection/rpcHealth.ts and a first version of this test
		// flagged it, which is why the pattern requires an invocation.
		expect(
			usesRunes(
				'let $state: RpcHealthValue = {healthy: true};\n' +
					'$state = state;\n' +
					'store.set($state);\n',
			),
		).toBe(false);
		// A DECLARED `$state` read through a PROPERTY. This is the same convention
		// as above but accessed with a dot, which is shape-identical to the member
		// rune `$state.raw(0)` and cannot be told apart by invocation alone. A
		// descendant (`game/core/round.ts`, a store snapshot read as `$state.step`)
		// failed on exactly this, which is what the declaration check exists for.
		expect(
			usesRunes(
				"let $state: RoundState = {step: 'Idle'};\n" +
					"if ($state.step !== 'Planning') return;\n" +
					"return 'actions' in $state ? $state.actions : [];\n",
			),
		).toBe(false);
		// But an UNdeclared one is still a rune, so the exemption cannot be used to
		// smuggle real rune usage into a `.ts` file.
		expect(usesRunes('let rows = $state.raw([]);')).toBe(true);
		// And declaring one name says nothing about another in the same file.
		expect(
			usesRunes('let $state = snapshot;\nconst v = $derived(x);\n'),
		).toBe(true);
	});

	it('has no .svelte.ts files', () => {
		const offenders = trackedFiles().filter((path) =>
			path.endsWith('.svelte.ts'),
		);
		expect(
			offenders,
			`AGENTS.md: never create .svelte.ts files. Put reusable logic in a ` +
				`plain .ts module and expose reactivity as a svelte/store, which ` +
				`components consume with $store and wire to their own lifecycle.`,
		).toEqual([]);
	});

	it('keeps runes inside .svelte components', () => {
		const offenders = trackedFiles()
			.filter((path) => path.endsWith('.ts'))
			.filter((path) => usesRunes(readFileSync(`${root}${path}`, 'utf8')));
		expect(
			offenders,
			`these use Svelte runes in a .ts file: ${offenders.join(', ')}. ` +
				`AGENTS.md: logic lives in .ts, reactivity crosses the boundary as ` +
				`stores (writable/readable/derived), and components own the ` +
				`$effect/lifecycle wiring themselves.`,
		).toEqual([]);
	});
});
