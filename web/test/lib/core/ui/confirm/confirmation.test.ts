import {describe, it, expect} from 'vitest';
import {get} from 'svelte/store';
import type {ConfirmationState} from '$lib/core/ui/confirm/confirmation';
import {makeConfirmation} from './make-confirmation';

/**
 * The confirmation is a PROMPT OVERLAY (ADR-0004, `work` branch), not a
 * mechanism of its own, and these are the promises that switch buys.
 *
 * The ones worth having are the last four: before the migration, `ask()`
 * resolved only when a button was pressed or the asker withdrew, so navigating
 * away, pressing back, or tearing the context down left the caller awaiting a
 * promise for the life of the tab, with no dialog on screen to explain what it
 * was waiting for. Every one of those now settles `false`, through the
 * registry's single close path, because `onClose` runs however an overlay
 * closes.
 */
const asking = (state: ConfirmationState) =>
	state as Extract<ConfirmationState, {step: 'asking'}>;

const QUESTION = {
	title: 'Really?',
	explanation: 'This cannot be undone.',
	confirmLabel: 'Do it',
};

describe('confirmation, as a prompt overlay', () => {
	it('resolves true when the affirmative button is pressed', async () => {
		const {confirmation} = makeConfirmation();

		const answer = confirmation.ask(QUESTION);
		expect(get(confirmation).step).toBe('asking');

		asking(get(confirmation)).onConfirm();

		await expect(answer).resolves.toBe(true);
		expect(get(confirmation).step).toBe('idle');
	});

	it('resolves false when the negative button is pressed', async () => {
		const {confirmation} = makeConfirmation();

		const answer = confirmation.ask(QUESTION);
		asking(get(confirmation)).onCancel();

		await expect(answer).resolves.toBe(false);
		expect(get(confirmation).step).toBe('idle');
	});

	it('resolves false when the asker withdraws the question', async () => {
		// The worked case: the user is asked whether they really want to give up
		// on a wallet request, and the wallet answers while they are reading.
		const {confirmation} = makeConfirmation();

		const answer = confirmation.ask(QUESTION);
		confirmation.withdraw();

		await expect(answer).resolves.toBe(false);
		expect(get(confirmation).step).toBe('idle');
	});

	it('replaces a question with the next one, resolving the first false', async () => {
		const {confirmation} = makeConfirmation();

		const first = confirmation.ask(QUESTION);
		const second = confirmation.ask({...QUESTION, title: 'Second'});

		await expect(first).resolves.toBe(false);
		expect(asking(get(confirmation)).title).toBe('Second');

		asking(get(confirmation)).onConfirm();
		await expect(second).resolves.toBe(true);
	});

	it('keeps ONE history entry when a question replaces another', () => {
		// Retargeting rather than close-then-open. Two entries for what the user
		// sees as one dialog changing its words would make the back gesture need
		// two presses to leave a single question.
		const {confirmation, browser} = makeConfirmation();
		const before = browser.depth();

		confirmation.ask(QUESTION);
		const withOneOpen = browser.depth();
		confirmation.ask({...QUESTION, title: 'Second'});

		expect(withOneOpen).toBe(before + 1);
		expect(browser.depth()).toBe(withOneOpen);
	});

	it('never puts the question in the URL', () => {
		// It asks about an action in flight, so restoring it after a reload would
		// restore a question about a run whose context is gone, and the URL is
		// shareable, which would turn "really give up?" into a link.
		const {confirmation, browser} = makeConfirmation();
		const before = browser.current().url.href;

		confirmation.ask(QUESTION);

		expect(browser.current().url.href).toBe(before);
	});

	it('resolves false when the user navigates to another page', async () => {
		// A question about an action on the page the user just left is a question
		// about nothing. Before this was an overlay, the caller kept waiting.
		const {confirmation, browser} = makeConfirmation();

		const answer = confirmation.ask(QUESTION);
		browser.navigateTo('https://app.test/explorer/address/0x1/');

		await expect(answer).resolves.toBe(false);
		expect(get(confirmation).step).toBe('idle');
	});

	it('resolves false when the user presses back', async () => {
		// The dismissal that has no keyboard equivalent on a phone. It is also the
		// one that used to leave nothing behind to settle the promise.
		const {confirmation, browser} = makeConfirmation();

		const answer = confirmation.ask(QUESTION);
		browser.back();

		await expect(answer).resolves.toBe(false);
		expect(get(confirmation).step).toBe('idle');
	});

	it('resolves false when the registry is torn down', async () => {
		// Context teardown (a second createContext, an HMR reload). An asker
		// abandoned mid-question is a promise nobody will ever settle.
		const {confirmation, registry} = makeConfirmation();

		const answer = confirmation.ask(QUESTION);
		registry.stop();

		await expect(answer).resolves.toBe(false);
	});
});
