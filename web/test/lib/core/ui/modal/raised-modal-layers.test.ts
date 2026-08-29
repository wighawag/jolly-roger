import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';

/**
 * A MODAL RAISED FROM A SYSTEM MODAL MUST BE IN THE SYSTEM LAYER.
 *
 * The bug this exists for: `InsufficientFundsModal` is `layer="system"` and
 * offers "Top up the in-app balance". `TopUpModal` named no layer, took the
 * default, `'modal'`, and a layer is a stacking context - so it rendered
 * UNDERNEATH the dialog whose button had just opened it, and the user got "Let
 * this browser play for you" showing through the modal covering it.
 * `ConfirmationModal`, declared in the same block for the same reason, had it
 * too.
 *
 * WHY THIS IS A SOURCE CHECK AND NOT A RENDER.
 *
 * The runtime rule - that a layer outranks declaration order, in both
 * directions - is pinned upstream against real dialogs in
 * `modal-layer-stacking.svelte.test.ts`. Repeating it here with stand-in
 * components would prove something about the stand-ins. What was actually
 * missing was cheaper and duller: nothing checked what THESE files pass. The
 * rule was correctly written down in `app.css`, in `modal.svelte` and in
 * `AcrossPages.svelte`, and all three were consistent with each other and with
 * the wrong code, for as long as the bug existed.
 *
 * `layer` is a required prop now, so it cannot be omitted again. It can still be
 * given the wrong value, and for these two that is not a judgement call: they
 * are opened from a system modal, so there is one correct answer and this is it.
 */
const root = new URL('../../../../../', import.meta.url).pathname;

const sourceOf = (path: string) => readFileSync(root + path, 'utf8');

/** The `layer` a component's own `<Modal.Root>` passes. */
function declaredLayer(path: string): string | undefined {
	const source = sourceOf(path);
	const root = source.slice(source.indexOf('<Modal.Root'));
	return root.match(/layer=["']([a-z]+)["']/)?.[1];
}

describe('modals opened from a system modal', () => {
	it.each([
		[
			'the top-up modal',
			'src/lib/ui/credits/TopUpModal.svelte',
			'src/lib/core/transaction/InsufficientFundsModal.svelte',
		],
		[
			'the confirmation modal',
			'src/lib/core/ui/confirm/ConfirmationModal.svelte',
			'src/lib/core/transaction/InsufficientFundsModal.svelte',
		],
	])(
		'%s is in the system layer, like the modal that raises it',
		(_, raised, raiser) => {
			expect(declaredLayer(raiser)).toBe('system');
			expect(declaredLayer(raised)).toBe('system');
		},
	);

	it('has the funds modal offering the top-up, which is what makes them a pair', () => {
		// If this stops being true the test above is guarding a relationship that
		// no longer exists, and should be deleted rather than left passing.
		//
		// The OPEN PAREN, not `start()`, because the flow now takes the purpose of
		// the payment from whoever opens it (see ui/credits/funding-purpose.ts).
		// What this line is checking is that this modal still raises that one, and
		// the argument is no business of a layering test.
		expect(
			sourceOf('src/lib/core/transaction/InsufficientFundsModal.svelte'),
		).toContain('topUp.start(');
	});
});
