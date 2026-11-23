import {expect, type Page} from '@playwright/test';
import {MAIN_PAGE} from '../routes';

/**
 * The contracts page, as a place several suites have to drive.
 *
 * WHICH CONTRACT, WHICH WRITE AND WITH WHAT are `MAIN_PAGE` of `../routes.ts`,
 * the seam a node sets: everything here is about the PAGE, which every app on
 * this template ships unchanged, so a node whose contract is not the greetings
 * demo's edits neither this file nor the suites that read it. Two descendants
 * used to carry a copy each (template-commit-reveal's `selectContract`,
 * template-zk-game's `sendHarmlessWrite`), each modifying the four files that
 * read it; this is the one both shapes fit.
 *
 * SEPARATE FROM `stalling-wallet.ts`, and the separation is load-bearing rather
 * than tidiness. `test/e2e-account-claims.test.ts` reads "imports
 * fixtures/stalling-wallet" as "drives the stalling wallet, and therefore claims
 * one of its accounts", which is the right heuristic: that pool exists so two
 * suites cannot race for one address's nonce. A suite that only wants a form
 * locator imports it from here and claims nothing. Who is asked to sign the
 * write is the caller's business.
 */

/** The contract the writes live on, which is NOT always the one the page opens on. */
export const WRITE_CONTRACT = MAIN_PAGE.contract;

/** The write the suites send (see `MainPageWrite` in `../routes.ts`). */
export const WRITE_FUNCTION = MAIN_PAGE.write.function;

/** A view function of the same contract, for the Read tab's suites. */
export const READ_FUNCTION = MAIN_PAGE.read;

/** What a write is labelled when its caller does not care. */
export const DEFAULT_LABEL = 'a request nobody answers';

/** The values the write's form is filled with for `label`, one per input. */
export function writeArgs(label: string = DEFAULT_LABEL): readonly string[] {
	return MAIN_PAGE.write.args(label);
}

/** What the trigger says before `$deployments` has loaded. */
const PLACEHOLDER = 'Select a contract';

/**
 * Reach /contracts the way a user does once the app is open: a CLIENT-SIDE
 * navigation, not `page.goto`. A full load restarts the app, and account data
 * comes back asynchronously, so a send made straight after it is broadcast but
 * cannot be recorded as an operation ("accountData not ready"): the pending
 * badge never appears and the inspector has nothing to show. A page that is not
 * in the app yet gets the full load, which is then the first load anyway.
 */
export async function goToContractsPage(page: Page): Promise<void> {
	if (!page.url().startsWith('http')) {
		await page.goto('/contracts/');
		return;
	}
	if (/\/contracts\/?$/.test(new URL(page.url()).pathname)) return;
	// An anchor click is what SvelteKit's router intercepts; retried because a
	// click during hydration can be swallowed.
	await expect(async () => {
		await page.evaluate(() => {
			const a = document.createElement('a');
			a.href = new URL('/contracts/', location.origin).href;
			document.body.appendChild(a);
			a.click();
			a.remove();
		});
		await page.waitForURL(/\/contracts\/?$/, {timeout: 3_000});
	}).toPass({timeout: 15_000});
}

/**
 * Put the contracts page on a named contract.
 *
 * THE PAGE OPENS ON WHICHEVER CONTRACT SORTS FIRST, because it shows
 * `Object.keys($deployments.contracts)[0]`. That is not a property anything
 * guarantees: in template-commit-reveal a branch that added a sale called
 * `AvatarSale` moved the page off the game and failed four tests that never
 * named a contract at all, and in template-zk-game the first contract is a
 * verifier with no writes. So a suite that means the main page's contract asks
 * for it. Calling this when the page is already there costs one comparison and
 * no round trip.
 */
export async function selectContract(
	page: Page,
	name: string = WRITE_CONTRACT,
): Promise<void> {
	// BY ITS `data-testid`, NOT BY ROLE OR TEXT. bits-ui renders the trigger as
	// a plain `button` whose accessible name is the selected contract, so
	// `getByRole('combobox')` matches nothing here, and its text changes with the
	// selection; the page gives it a stable hook (`contracts/+page.svelte`).
	const trigger = page.getByTestId('contract-selector');
	await expect(trigger).toBeVisible({timeout: 30_000});
	// WAIT FOR THE CONTRACTS TO LOAD before reading which one is showing. Until
	// `$deployments` arrives the trigger says "Select a contract" and the
	// dropdown has NO items, so an early click opens an empty list and waits out
	// its whole timeout on an item that was never going to be there.
	await expect(trigger).not.toHaveText(PLACEHOLDER, {timeout: 30_000});
	const selected = () => trigger.textContent().then((t) => (t ?? '').trim());
	if ((await selected()) === name) return;

	// EXACTLY, because the list is `Object.keys(deployments.contracts)` and a
	// routed proxy publishes a dozen of them (`Game`, `Game_Proxy`,
	// `Game_Implementation`, one entry per route): a substring match on the name
	// is ambiguous between all of them.
	const option = page
		.locator('[data-slot="select-item"]')
		.filter({hasText: new RegExp(`^\\s*${name}\\s*$`)})
		.first();
	// A click during hydration can be swallowed (the handler is not attached
	// yet), leaving the menu shut: retry the opening.
	await expect(async () => {
		if (!(await option.isVisible())) await trigger.click();
		await expect(option).toBeVisible({timeout: 2_000});
	}).toPass({timeout: 30_000});
	// LET THE OPEN LIST COME TO REST BEFORE CLICKING IN IT, or the click can be
	// dropped. The list opens with an animation, so a click started at once finds
	// the option "not stable", and Playwright's third attempt scrolls it to the
	// top of the list before pressing. That scroll is programmatic: its `scroll`
	// event, and bits-ui's answer to it (the scroll-up button mounts and pushes
	// every item 24px down), come in the next frame. When that frame falls
	// between the press and the release, the release lands on the scroll button,
	// and bits-ui, which selects on the release of an ITEM, drops the click (found
	// in stratagems, 2026-10-30). So the list is left to finish opening, the
	// option is brought into view, and the list is left to settle again.
	await option.evaluate(async (el) => {
		const list = el.closest('[data-slot="select-content"]') ?? el;
		const still = () =>
			new Promise<void>((resolve) => {
				const started = performance.now();
				let last = '';
				let frames = 0;
				const frame = () => {
					const r = el.getBoundingClientRect();
					const at = `${r.x},${r.y},${r.width},${r.height}`;
					const moving = list
						.getAnimations({subtree: true})
						.some((a) => a.playState === 'running');
					frames = at === last && !moving ? frames + 1 : 0;
					last = at;
					if (frames >= 3 || performance.now() - started > 5_000) resolve();
					else requestAnimationFrame(frame);
				};
				requestAnimationFrame(frame);
			});
		await still();
		el.scrollIntoView({block: 'nearest'});
		await still();
	});
	await option.click({timeout: 30_000});
	await expect.poll(selected, {timeout: 30_000}).toBe(name);
}

/** /contracts, on `name` (the main page's contract unless told otherwise). */
export async function openContract(
	page: Page,
	name: string = WRITE_CONTRACT,
): Promise<void> {
	await goToContractsPage(page);
	await selectContract(page, name);
}

/**
 * The card of the function `functionName`, by the name the page gives it
 * (`data-function-name`, `ContractFunction.svelte`), NOT by its title: the
 * title carries the mutability badge too, so matching its text is ambiguous
 * between a function and every other one whose name it contains.
 */
export function functionCard(page: Page, functionName: string) {
	return page
		.locator(
			`[data-testid="contract-function"][data-function-name="${functionName}"]`,
		)
		.first();
}

/**
 * The write form the suites drive, and its submit control.
 *
 * Exported because a suite asserts on the very control it clicked (that it says
 * "Executing..." and stops saying it), and two definitions of the same locator
 * is one definition too many.
 *
 * The submit control is matched on the STEM, so it is the same locator whether
 * it reads "Execute" or "Executing...". `/execute/i` matches only the first of
 * those, since "executing" does not contain "execute", and a test then reads as
 * though the button had vanished at exactly the moment it was busy.
 */
export const writeForm = (page: Page) => functionCard(page, WRITE_FUNCTION);

export const executeButton = (page: Page) =>
	writeForm(page).locator('button', {hasText: /execut/i});

/** The write form's `index`th input, in the order the page lists them. */
export const writeInput = (page: Page, index = 0) =>
	writeForm(page).locator(`[id$="input-${index}"]`).first();

/** /contracts on the main page's contract, its Write tab open on the write. */
export async function openWrite(page: Page): Promise<void> {
	await openContract(page);
	const writeTab = page.getByRole('tab', {name: 'Write'});
	await expect(writeTab).toBeVisible({timeout: 30_000});
	await writeTab.click();
	await expect(writeForm(page)).toBeVisible({timeout: 30_000});
}

/**
 * Fill the write's form from `label` (see `MainPageWrite.args`).
 *
 * A `bool` input is a `<select>` (`Select...`, `true`, `false`, in
 * `FunctionInputs.svelte`) under the same `input-<index>` id, and `.fill()`
 * refuses a `<select>`: so each input is filled the way its element takes a
 * value, the option chosen by its value (`'true'` or `'false'`) for a select.
 */
export async function fillWrite(
	page: Page,
	label: string = DEFAULT_LABEL,
): Promise<void> {
	const values = writeArgs(label);
	for (const [index, value] of values.entries()) {
		const input = writeInput(page, index);
		const tag = await input.evaluate((el) => el.tagName.toLowerCase());
		if (tag === 'select') await input.selectOption(value);
		else await input.fill(value);
	}
}

/**
 * Open the write, fill it from `label` and press Execute. What follows (a
 * connect flow, a wallet, a confirmation) is the caller's.
 */
export async function sendWrite(
	page: Page,
	label: string = DEFAULT_LABEL,
): Promise<void> {
	await openWrite(page);
	await fillWrite(page, label);
	await executeButton(page).click();
}
