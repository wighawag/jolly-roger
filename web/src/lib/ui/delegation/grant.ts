/**
 * What the key this browser holds is allowed to do, in THIS app's terms.
 *
 * The template owns the sentences; an app owns the verb phrase inside them.
 * That split exists because the sentences are the same everywhere ("it cannot
 * move your funds", "you can withdraw it later") and the verb phrase is never
 * the same twice: a greeting demo posts greetings, a game plays your moves, a
 * shop buys things for you.
 *
 * WHY THIS FILE EXISTS AT ALL. The sentences below used to be written out in
 * `ui/credits/TopUpModal.svelte` and `ui/delegation/delegation-view.ts` with
 * the demo's own words baked in, so every app on this tree told its users that
 * the key was for "posting greetings" - in the one dialog where the app most
 * needs to sound like it knows what it is doing, at the moment it is asking
 * them to authorise a key. Nobody noticed, because nobody reads that dialog in
 * a game. A shared component cannot know what the app is for, so it must be
 * told rather than left to guess.
 *
 * The same rule is already written down next door, in `delegation-check.ts`:
 * "what the delegate will be used FOR belongs to the app". This is that rule
 * with somewhere to put the answer.
 */

export type SignerGrant = {
	/**
	 * What the key does, as a VERB PHRASE that completes the frames below.
	 *
	 * "post greetings", "play your moves", "buy and equip your avatars". Lower
	 * case, no trailing full stop: it lands mid-sentence. Read the frames in
	 * `keyExplanation` and `consentBullets` before choosing one, because a
	 * phrase that only reads well in one of them will read badly in the others.
	 */
	action: string;
	/**
	 * Anything else this app's key may do, as whole sentences.
	 *
	 * Appended to the consent list after the entry built from `action` and
	 * before the two limits. For a grant that carries more than the usual
	 * authority, and where saying so before the wallet opens is the honest
	 * thing to do. Most apps leave this out.
	 */
	alsoAllows?: readonly string[];
};

/**
 * Why this browser holds a key at all.
 *
 * Shown before the user has agreed to anything, so it explains the ARRANGEMENT
 * rather than asking for consent to it.
 */
export function keyExplanation(grant: SignerGrant): string {
	return `This browser holds a key so the app can ${grant.action} without asking you to sign every time. One transaction authorises it and gives it the gas it needs.`;
}

/**
 * What signing the authorisation allows, and what it does not.
 *
 * ONE LIST, in this order, because the order is the argument: what it lets the
 * key do, then the two things that bound it. A user reading only the first
 * bullet has been told the worst case, and a user reading all three has been
 * told why it is safe. Same shape and tone as the sign-in modal (see
 * `core/connection/ConnectionFlow.svelte`).
 *
 * The two limits are facts about the registry contract rather than about any
 * app, which is why they are not the app's to supply: a delegate may act for
 * the account at this one contract, it holds no authority over the account's
 * funds, and `revokeDelegate` is always available to the owner.
 */
export function consentBullets(grant: SignerGrant): readonly string[] {
	return [
		`It lets this browser ${grant.action} in your name.`,
		...(grant.alsoAllows ?? []),
		'It cannot move your funds, or anything else you own.',
		'You can withdraw it later from your account panel.',
	];
}

/**
 * Whether this browser may act, for the account panel's delegation row.
 *
 * Three states rather than two: the chain read is asynchronous, and a row that
 * says "cannot" while it is still loading is stating something it does not yet
 * know.
 */
export function grantStatus(
	grant: SignerGrant,
	state: 'authorised' | 'not-authorised' | 'checking',
): string {
	if (state === 'authorised') {
		return `This browser can ${grant.action} in your name.`;
	}
	if (state === 'checking') {
		return `Checking whether this browser can ${grant.action} in your name...`;
	}
	return `This browser cannot yet ${grant.action} in your name.`;
}
