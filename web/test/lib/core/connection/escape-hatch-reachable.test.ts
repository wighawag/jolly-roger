import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * AN EXIT THAT EXISTS SOMEWHERE ELSE IS NOT AN EXIT.
 *
 * `wallet-activity.ts` decides whether this moment traps the user (`escapable`)
 * and, as its exact complement, whether a stray click may tear the flow down
 * (`dismissable`). The flow renders the second faithfully: four modals pass
 * `onCancel={dismissable ? dismiss : undefined}`, which removes their close X,
 * swallows escape and refuses click-outside while a dispatch is outstanding.
 *
 * The first was rendered by ACCIDENT. Only the waiting modals carried the
 * trigger, and the reason nobody noticed is that "Wallet Action Required" was
 * raised for every dispatch, so whenever a modal refused dismissal that one was
 * on screen too, holding the only honest way out. Narrowing that modal to
 * dispatches a human was actually asked about (a local signer's sends raise no
 * modal, correctly) took the borrowed exit away, and what was left in those four
 * modals was their own Cancel button: `connection.cancel()`, which clears the
 * account that `transaction:broadcasted` writes into. That is the
 * disconnect-and-lose-the-transaction bug, offered as the only remaining choice.
 *
 * So the rule, checked rather than intended: A MODAL THAT REFUSES DISMISSAL
 * BECAUSE SOMETHING IS IN FLIGHT MUST OFFER THE ESCAPE HATCH. The trigger
 * renders itself only `{#if escapable}`, so this costs nothing in every other
 * state.
 *
 * Structural, like `connection-flow-ledger.test.ts` next door: mounting five
 * modals to prove a button exists is a slower, more brittle way to read the same
 * file. What it cannot see is CSS or stacking, which is the residual risk.
 */
const source = readFileSync(
	fileURLToPath(
		new URL(
			'../../../../src/lib/core/connection/ConnectionFlow.svelte',
			import.meta.url,
		),
	),
	'utf-8',
);

/**
 * The file split into top-level modal blocks.
 *
 * Split on the CLOSING tags, so each chunk ends with exactly one modal and
 * carries the props of the one it closes. Good enough because the flow's modals
 * are siblings; a nested one would fold into its parent's chunk, which can only
 * make this rule stricter, never blinder.
 */
const modalBlocks = source
	.split(/<\/(?:Modal\.Root|BasicModal)>/)
	.filter((block) => /<(?:Modal\.Root|BasicModal)\b/.test(block));

const RENDERS_HATCH = '{@render escapeHatch()}';

describe('the escape hatch is reachable wherever the user can be trapped', () => {
	it('is looking at the real modals', () => {
		// Guards the guard: a rename, a reformat or a bad split would make every
		// rule below vacuously true, which is the failure mode of a test that
		// reads a file.
		expect(modalBlocks.length).toBeGreaterThanOrEqual(5);
		expect(source).toContain('{#snippet escapeHatch()}');
		expect(
			modalBlocks.filter((block) => block.includes(RENDERS_HATCH)).length,
		).toBeGreaterThan(0);
	});

	it('offers it in every modal that refuses dismissal while dispatching', () => {
		const gated = modalBlocks.filter((block) =>
			block.includes('onCancel={dismissable'),
		);
		// Guards the guard: if the gating disappears the rule must fail loudly
		// rather than pass by having nothing to check.
		expect(gated.length).toBeGreaterThanOrEqual(4);

		const missing = gated.filter((block) => !block.includes(RENDERS_HATCH));
		expect(
			missing.map((block) => block.slice(0, 200)),
			'these modals refuse a stray click because a dispatch is outstanding, ' +
				'and then offer no honest way out of it: their only remaining exit is ' +
				'a Cancel button wired to connection.cancel(), which disconnects with ' +
				'a transaction in flight and loses it. Render {@render escapeHatch()}.',
		).toEqual([]);
	});

	it('offers it in the modals that exist only to be waited on', () => {
		// The original three, kept explicit so a refactor that drops one is caught
		// by name rather than by a count.
		for (const marker of [
			'Waiting for Wallet Connection...',
			"openWhen={$connection.step === 'WaitingForSignature'}",
			"openWhen={$connection.step === 'PopupLaunched'}",
		]) {
			const block = modalBlocks.find((b) => b.includes(marker));
			expect(block, marker).toBeDefined();
			expect(block?.includes(RENDERS_HATCH), marker).toBe(true);
		}
	});
});
