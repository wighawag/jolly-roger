import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LAYERS} from '$lib/core/ui/layers';

/**
 * These are guards, not unit tests. The stacking bug they exist for was not a
 * wrong value anywhere: it was a target nobody passed, in a component whose
 * portal defaults to `document.body`, failing SILENTLY and in the direction
 * that puts the overlay on top. Nothing observable broke until a modal opened
 * from the account panel and rendered underneath it.
 *
 * So what needs holding is the arrangement itself: layers ordered on purpose,
 * every portal aimed at one, and no dead portal declarations pretending to do
 * the aiming.
 */

const web = (path: string) =>
	fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(web(path), 'utf-8');

/**
 * Source with comments removed. The rules below are about what the code DOES,
 * and the comments explaining these very rules quote the patterns they ban.
 */
const code = (path: string) => read(path).replace(/<!--[\s\S]*?-->/g, '');

/**
 * The `--z-layer-*` scale, read in declaration order.
 *
 * Parsed rather than imported because it is CSS: this file and `app.css` are
 * the two halves of one decision (which layers exist, and what covers what),
 * and the whole point of the tests below is that neither half can move alone.
 */
function cssLayerScale(): {name: string; z: number}[] {
	const css = read('src/app.css');
	return [...css.matchAll(/--z-layer-([a-z]+):\s*(\d+);/g)].map((match) => ({
		name: match[1],
		z: Number(match[2]),
	}));
}

describe('stacking layers', () => {
	it('paints bottom to top in declaration order', () => {
		const zs = cssLayerScale().map((l) => l.z);
		expect(zs).toEqual([...zs].sort((a, b) => a - b));
		expect(new Set(zs).size).toBe(zs.length);
	});

	it('declares the same layers as app.css, in the same order', () => {
		// The failure this catches is silent in both directions. A layer here with
		// no rule there gets `z-index: auto`, so it is not a stacking context at
		// all and everything portalled into it competes in the root context, which
		// is the bug the whole scheme exists to prevent. A rule there with no layer
		// here is a number nobody can aim at.
		expect(cssLayerScale().map((l) => l.name)).toEqual(
			LAYERS.map((l) => l.name),
		);
	});

	it('applies a rule to every layer it declares', () => {
		const css = read('src/app.css');
		for (const layer of LAYERS) {
			expect(css, `app.css has no [data-layer='${layer.name}'] rule`).toContain(
				`[data-layer='${layer.name}']`,
			);
		}
	});

	it('names layers consistently, and selector follows id', () => {
		for (const layer of LAYERS) {
			expect(layer.id).toMatch(/^--layer-[a-z]+$/);
			expect(layer.selector).toBe(`#${layer.id}`);
			expect(layer.name).toMatch(/^[a-z]+$/);
		}
		expect(new Set(LAYERS.map((l) => l.id)).size).toBe(LAYERS.length);
		expect(new Set(LAYERS.map((l) => l.name)).size).toBe(LAYERS.length);
	});

	it('renders one container per layer, from the list itself', () => {
		const layout = read('src/routes/+layout.svelte');
		expect(layout).toContain('{#each LAYERS as layer');
		expect(layout).toContain('id={layer.id}');
		expect(layout).toContain('data-layer={layer.name}');
		// A hardcoded id or name here would mean the containers and the targets can
		// drift: a layer could be aimed at with nowhere to land, which is the
		// failure that portals to `body` instead.
		expect(layout.match(/id="--layer-[a-z]+"/g)).toBeNull();
		expect(layout.match(/data-layer="[a-z]+"/g)).toBeNull();
	});
});

describe('portalled overlays', () => {
	/**
	 * shadcn's overlay Contents wrap themselves in their own portal, so the
	 * target has to be set THERE to hold for every call site. Any Content that
	 * portals without naming a layer defaults to `document.body`, escapes the
	 * layer system entirely, and floats above everything by accident.
	 */
	const shadcnUi = 'src/lib/shadcn/ui';

	const contentFiles = readdirSync(web(shadcnUi), {withFileTypes: true})
		.filter((e) => e.isDirectory())
		.flatMap((dir) =>
			readdirSync(web(`${shadcnUi}/${dir.name}`))
				.filter((f) => f.endsWith('-content.svelte'))
				.map((f) => `${shadcnUi}/${dir.name}/${f}`),
		);

	const selfPortalling = contentFiles.filter((f) =>
		/<\w*Portal\b/.test(code(f)),
	);

	it('finds the overlay Contents that portal, so this guard cannot go quiet', () => {
		// If shadcn components are added or removed this number moves, which is
		// fine; a drop to zero would mean the assertion below stopped testing
		// anything at all.
		expect(selfPortalling.length).toBeGreaterThanOrEqual(4);
	});

	it.each(selfPortalling)('%s sends its portal to a declared layer', (file) => {
		const source = code(file);
		const portal = source.match(/<\w*Portal\b[^>]*>/)?.[0] ?? '';
		const target = portal.match(/\bto=\{(\w+)\}/)?.[1];

		expect(target, `${file} portals with no layer target`).toBeDefined();
		// The target must be one of the exported layer constants, not a literal or
		// a locally invented string.
		expect(source).toMatch(
			new RegExp(
				`import\\s*\\{[^}]*\\b${target}\\b[^}]*\\}\\s*from\\s*["'][^"']*core/ui/layers["']`,
			),
		);
	});

	it('has no childless Portal declaration anywhere in the app', () => {
		// `<Dialog.Portal to="#x" />` with no children renders NOTHING. It reads
		// like it sets the target, type-checks, and is dead. That is the exact
		// shape of the original bug, so it is banned outright: the target belongs
		// on Content, which owns the real portal.
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(web(dir), {withFileTypes: true})) {
				const path = `${dir}/${entry.name}`;
				if (entry.isDirectory()) {
					walk(path);
					continue;
				}
				if (!entry.name.endsWith('.svelte')) continue;
				// shadcn's own *-portal.svelte wrappers are the legitimate childless
				// case: they ARE the portal primitive, re-exported.
				if (entry.name.endsWith('-portal.svelte')) continue;
				if (/<[A-Z]\w*\.Portal\b[^>]*\/>/.test(code(path)))
					offenders.push(path);
			}
		};
		walk('src');
		expect(offenders).toEqual([]);
	});
});
