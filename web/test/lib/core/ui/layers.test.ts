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

/** The overlays that live outside the layer system, and must stay above it. */
const NOTIFICATION_OVERLAY_Z = 999;

describe('stacking layers', () => {
	it('paints bottom to top in declaration order', () => {
		const zs = LAYERS.map((l) => l.z);
		expect(zs).toEqual([...zs].sort((a, b) => a - b));
		expect(new Set(zs).size).toBe(zs.length);
	});

	it('stays below the app-level signals that must never be hidden', () => {
		// The notification overlay and the navigation progress bar are how the app
		// tells the user something happened. A modal is allowed to block the page;
		// it is not allowed to swallow those.
		for (const layer of LAYERS) {
			expect(layer.z).toBeLessThan(NOTIFICATION_OVERLAY_Z);
		}
	});

	it('names layers consistently, and selector follows id', () => {
		for (const layer of LAYERS) {
			expect(layer.id).toMatch(/^--layer-[a-z]+$/);
			expect(layer.selector).toBe(`#${layer.id}`);
		}
		expect(new Set(LAYERS.map((l) => l.id)).size).toBe(LAYERS.length);
	});

	it('renders one container per layer, from the list itself', () => {
		const layout = read('src/routes/+layout.svelte');
		expect(layout).toContain('{#each LAYERS as layer');
		expect(layout).toContain('id={layer.id}');
		// A hardcoded id here would mean the containers and the targets can drift:
		// a layer could be aimed at with nowhere to land, which is the failure
		// that portals to `body` instead.
		const hardcoded = layout.match(/id="--layer-[a-z]+"/g);
		expect(hardcoded).toBeNull();
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
