import {describe, it, expect} from 'vitest';
import {
	consentBullets,
	grantStatus,
	keyExplanation,
	type SignerGrant,
} from '$lib/ui/delegation/grant';

/**
 * THE BUG THIS FILE EXISTS FOR.
 *
 * The sentences below were written out inside `ui/credits/TopUpModal.svelte`
 * and `ui/delegation/delegation-view.ts` with the greeting demo's own words in
 * them. Both files are inherited by every app on this template tree, so a game
 * about avatars showed its players a sentence about posting greetings - in the
 * dialog where it was asking them to authorise a key, which is the one moment
 * an app most needs to sound like it knows what it is doing. It had presumably
 * been wrong in every downstream app since it was written, and nobody noticed,
 * because nobody reads that dialog in a game.
 *
 * So the tests here are about the SEAM rather than about the wording: the
 * template owns the sentence frames, the app owns the verb phrase inside them,
 * and a frame that stops using the app's phrase fails here.
 */

/** Deliberately not this template's own demo: see above. */
const GRANT: SignerGrant = {action: 'feed the cat'};

describe('the app supplies what the key is for', () => {
	it('puts the app’s words in every sentence about the key', () => {
		const everything = [
			keyExplanation(GRANT),
			...consentBullets(GRANT),
			grantStatus(GRANT, 'authorised'),
			grantStatus(GRANT, 'not-authorised'),
			grantStatus(GRANT, 'checking'),
		];

		// The one that matters: the sentence naming what the key may do. A frame
		// that hard-codes an action instead of taking the grant's shows up as this
		// failing, whichever app it is hard-coded for.
		expect(consentBullets(GRANT)[0]).toContain(GRANT.action);

		// And nothing anywhere still names the demo.
		for (const line of everything) {
			expect(line).not.toMatch(/greeting/i);
		}
	});

	it('states the limits itself, because they are not the app’s to soften', () => {
		// These two are facts about the registry contract rather than about any
		// app: a delegate acts for the account at one contract, it has no authority
		// over the account's funds, and the owner can always call `revokeDelegate`.
		// An app that could word them could also word them away, and this is a
		// consent list.
		const bullets = consentBullets(GRANT);
		expect(bullets.some((line) => /cannot move your funds/i.test(line))).toBe(
			true,
		);
		expect(bullets.some((line) => /withdraw it later/i.test(line))).toBe(true);
	});

	it('says what it lets the key do BEFORE saying what it cannot', () => {
		// The order is the argument. A user who reads only the first line has been
		// told the worst case; one who reads all three has been told why it is
		// safe. Reversed, the list opens with reassurance about a grant it has not
		// described yet.
		const bullets = consentBullets(GRANT);
		expect(bullets[0]).toContain(GRANT.action);
		expect(bullets.indexOf(bullets[0])).toBeLessThan(
			bullets.findIndex((line) => /cannot/i.test(line)),
		);
	});

	it('carries an app’s extra grants without losing the limits', () => {
		// For a key that may do more than the usual, where saying so before the
		// wallet opens is the honest thing to do.
		const bullets = consentBullets({
			...GRANT,
			alsoAllows: ['It can spend the credits you fund it with.'],
		});
		expect(bullets).toContain('It can spend the credits you fund it with.');
		expect(bullets.some((line) => /cannot move your funds/i.test(line))).toBe(
			true,
		);
	});

	it('does not claim an authorisation it is still checking for', () => {
		// Three states rather than two: the chain read is asynchronous, and a row
		// that says "cannot" while it is still loading states something it does not
		// know.
		expect(grantStatus(GRANT, 'checking')).toMatch(/checking/i);
		expect(grantStatus(GRANT, 'checking')).not.toMatch(/cannot/i);
		expect(grantStatus(GRANT, 'not-authorised')).toMatch(/cannot/i);
		expect(grantStatus(GRANT, 'authorised')).toMatch(/can /i);
	});
});
