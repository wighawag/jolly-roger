import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

/**
 * Nothing interactive inside a button or a link, in any component.
 *
 * WHY THIS IS A TEST AND NOT A REVIEW COMMENT. The navbar's account row was a
 * collapsible trigger (a `<button>`) holding `<Address>`, whose copy control is
 * a `<button>` of its own, and the trigger was DISABLED whenever the wallet
 * exposes one account. A browser delivers no click to the content of a disabled
 * button, so the copy icon silently did nothing for every Rabby user, and worked
 * for anyone testing with several MetaMask accounts (QA F2). A button inside a
 * button is invalid HTML in every case, and what a browser then does with the
 * inner click is not something to depend on. Nothing typechecks it, and it only
 * shows at runtime, in one wallet configuration.
 *
 * WHAT COUNTS. Containers: `<button>`, shadcn's `<Button>`, `<a>`, and a bits-ui
 * `*.Trigger` (which renders a `<button>` unless it hands rendering to a `child`
 * snippet). Inside one of them, any of those again, a form control, or an
 * `<Address>` that still renders a control: its copy button (unless
 * `showCopy={false}`) or its link (`linkTo`). The fix is to put the inner
 * control BESIDE the outer one, or to drop it (`showCopy={false}` where the row
 * is itself the action, as in the connect flow's account picker).
 *
 * A deliberately small scanner rather than a parser: it reads markup only (no
 * script, style or comments) and tracks attribute braces and quotes, which is
 * all these components need. If it ever misreads a file, fix the scanner, do not
 * add an exemption list.
 */

const SRC = new URL('../src/', import.meta.url).pathname;

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return svelteFiles(path);
		return name.endsWith('.svelte') ? [path] : [];
	});
}

/** Blank out script, style and comments, keeping offsets (for line numbers). */
function markupOnly(source: string): string {
	const blank = (match: string) => match.replace(/[^\n]/g, ' ');
	return source
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank);
}

/** Index of the `>` closing the tag that starts at `start`, skipping `{...}` and quotes. */
function tagEnd(markup: string, start: number): number {
	let depth = 0;
	let quote: string | null = null;
	for (let i = start; i < markup.length; i++) {
		const c = markup[i];
		if (quote) {
			if (c === quote) quote = null;
		} else if (c === '"' || c === "'" || c === '`') {
			quote = c;
		} else if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
		} else if (c === '>' && depth === 0) {
			return i;
		}
	}
	return markup.length;
}

const CONTAINER = /^(button|Button|a|[A-Za-z]+\.Trigger)$/;
const CONTROL = /^(button|Button|a|input|select|textarea|[A-Za-z]+\.Trigger)$/;

/** Whether an `<Address>` with these attributes renders a button or a link. */
function addressIsInteractive(attributes: string): boolean {
	const copy = !/showCopy=\{false\}/.test(attributes);
	const link =
		/linkTo=/.test(attributes) && !/linkTo=\{false\}/.test(attributes);
	return copy || link;
}

export function nestedInteractive(source: string): string[] {
	const markup = markupOnly(source);
	const lineOf = (index: number) => markup.slice(0, index).split('\n').length;
	const stack: {name: string; line: number; delegated: boolean}[] = [];
	const found: string[] = [];
	const token = /<(\/?)([A-Za-z][\w.]*)|\{#snippet\s+child\b/g;
	for (let m = token.exec(markup); m; m = token.exec(markup)) {
		if (m[0].startsWith('{#snippet')) {
			// `<X.Trigger>{#snippet child({props})}<Button {...props}>`: the trigger
			// renders nothing of its own, the snippet's element IS the control.
			const top = stack[stack.length - 1];
			if (top && top.name.endsWith('.Trigger')) top.delegated = true;
			continue;
		}
		const [, slash, name] = m;
		const end = tagEnd(markup, m.index);
		const attributes = markup.slice(m.index + m[0].length, end);
		token.lastIndex = end;
		if (slash) {
			const at = stack.map((s) => s.name).lastIndexOf(name);
			if (at >= 0) stack.splice(at);
			continue;
		}
		const selfClosing = attributes.trimEnd().endsWith('/');
		const interactive =
			CONTROL.test(name) ||
			(name === 'Address' && addressIsInteractive(attributes));
		const outer = stack.filter((s) => !s.delegated);
		if (interactive && outer.length > 0) {
			const container = outer[outer.length - 1];
			found.push(
				`line ${lineOf(m.index)}: <${name}> inside <${container.name}> (line ${container.line})`,
			);
		}
		if (!selfClosing && CONTAINER.test(name)) {
			stack.push({name, line: lineOf(m.index), delegated: false});
		}
	}
	return found;
}

describe('no interactive content inside a button or a link', () => {
	it('flags the shapes it exists for, and passes their fixes', () => {
		// The F2 shape, and the list row beside it.
		expect(
			nestedInteractive(
				'<Collapsible.Trigger disabled={!many}><Address value={a} /></Collapsible.Trigger>',
			),
		).toHaveLength(1);
		expect(
			nestedInteractive(
				'<button onclick={() => pick(a)}><Address value={a} /></button>',
			),
		).toHaveLength(1);
		expect(
			nestedInteractive('<a href="/x"><Button>Go</Button></a>'),
		).toHaveLength(1);
		// The fixes: side by side, or no control left inside.
		expect(
			nestedInteractive(
				'<div><Address value={a} /><Collapsible.Trigger aria-label="Switch account"><Chevron /></Collapsible.Trigger></div>',
			),
		).toEqual([]);
		expect(
			nestedInteractive(
				'<button onclick={() => pick(a)}><Address value={a} showCopy={false} /></button>',
			),
		).toEqual([]);
		// A trigger that hands rendering to its child snippet is not a button.
		expect(
			nestedInteractive(
				'<Tooltip.Trigger>{#snippet child({props})}<Button {...props}>x</Button>{/snippet}</Tooltip.Trigger>',
			),
		).toEqual([]);
		// Arrows and comparisons in attributes do not end the tag early.
		expect(
			nestedInteractive(
				'<button onclick={() => (n > 1 ? a() : b())}>x</button><Address value={a} />',
			),
		).toEqual([]);
	});

	it('holds for every component in src/', () => {
		const offenders = svelteFiles(SRC).flatMap((path) =>
			nestedInteractive(readFileSync(path, 'utf8')).map(
				(hit) => `${relative(SRC, path)} ${hit}`,
			),
		);
		expect(
			offenders,
			'a control nested in a button or a link: put it beside the outer one ' +
				'(see this file and QA F2)',
		).toEqual([]);
	});
});
