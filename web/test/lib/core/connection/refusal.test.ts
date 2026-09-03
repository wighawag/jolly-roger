import {describe, it, expect} from 'vitest';
import {
	ConnectionFailure,
	type ConnectionFailureReason,
} from '@etherplay/connect';
import {
	connectionFailureView,
	connectionRefusal,
	isUserDecision,
	refusalExplanation,
	restingRefusal,
} from '$lib/core/connection/refusal';

/**
 * The two refusal payloads, exactly as the WALLET HOST posts them.
 *
 * Written out here rather than imported, because they are not this library's
 * types: they cross an origin boundary as JSON, and one of them is minted by the
 * host application, which this repo does not depend on at all. A fixture built
 * from a shared type would agree with itself while the wire disagreed.
 *
 * THEY NO LONGER DECIDE WHAT HAPPENED. Since @etherplay/connect 0.13.0 that is
 * `reason`; these are only the payload it says to expect. A host's own
 * vocabulary arrives as `host-refused` and is passed through, because the
 * library will not claim to understand a word it cannot verify.
 */
const PERMISSION_DENIED = {
	message: 'a required permission was denied',
	type: 'permission-denied',
	permissions: [
		{
			request: {
				type: 'delegation',
				required: true,
				chainId: 31337,
				contract: '0x00000000000000000000000000000000000000eE',
			},
			granted: false,
			reason: 'denied',
		},
	],
};

const CROSS_ORIGIN_BLOCKED = {
	message:
		'https://game.example may not request an account for https://wallet.example',
	type: 'cross-origin-blocked',
	windowOrigin: 'https://game.example',
	signingOrigin: 'https://wallet.example',
};

const failure = (
	message: string,
	reason: ConnectionFailureReason,
	cause?: unknown,
) => new ConnectionFailure(message, cause, reason);

describe('connectionRefusal: why ensureConnected rejected', () => {
	it('keeps the host payload for a refusal it passed through', () => {
		const refusal = connectionRefusal(
			failure(PERMISSION_DENIED.message, 'host-refused', PERMISSION_DENIED),
		);

		expect(refusal?.kind).toBe('host-refused');
		// Carried rather than dropped: a descendant declaring several permissions
		// needs to be able to name the one that blocked sign-in.
		expect(refusal?.permissions).toHaveLength(1);
	});

	it('reads a blocked origin, and both origins with it', () => {
		const refusal = connectionRefusal(
			failure(
				CROSS_ORIGIN_BLOCKED.message,
				'cross-origin-blocked',
				CROSS_ORIGIN_BLOCKED,
			),
		);

		expect(refusal).toMatchObject({
			kind: 'cross-origin-blocked',
			windowOrigin: 'https://game.example',
			signingOrigin: 'https://wallet.example',
		});
	});

	it('says nothing about an error that did not come from the connection', () => {
		// Call sites wrap a balance check and a writeContract in the same `try`, so
		// claiming those would silence real transaction errors.
		expect(connectionRefusal(new Error('execution reverted'))).toBeUndefined();
		expect(connectionRefusal(undefined)).toBeUndefined();
		expect(
			connectionRefusal({message: 'Connection cancelled'}),
		).toBeUndefined();
	});
});

describe('isUserDecision: told apart by reason, never by shape', () => {
	it('counts the two dismissals, which look identical from outside', () => {
		// An acknowledged addressUnavailable deliberately carries the SAME message
		// as a cancel, so that nothing paints a red error over a decision. Only
		// `reason` separates them, and both are answered with silence.
		expect(
			isUserDecision(
				connectionRefusal(failure('Connection cancelled', 'cancelled'))!,
			),
		).toBe(true);
		expect(
			isUserDecision(
				connectionRefusal(
					failure('Connection cancelled', 'address-unavailable-acknowledged'),
				)!,
			),
		).toBe(true);
	});

	it('DOES NOT count the answers that used to masquerade as a cancellation', () => {
		// THE REGRESSION THIS FILE EXISTS FOR. Both of these carry no cause, and
		// this module used to read "no cause" as "the user backed out", so the
		// outcome 0.12.0 added instead of hanging arrived as silence: the dialog
		// sat there having visibly done nothing. Reporting them is the entire
		// point of the reason field.
		for (const reason of ['unreachable', 'superseded'] as const) {
			const refusal = connectionRefusal(
				failure(`could not reach WalletConnected`, reason),
			);
			expect(isUserDecision(refusal!), reason).toBe(false);
		}
	});

	it('does not count a wallet declining, which is answerable', () => {
		// The user can try again and allow it, so it gets a sentence rather than
		// silence, unlike a deliberate dismissal of the whole flow.
		const refusal = connectionRefusal(
			failure('Connection request was declined.', 'wallet-rejected', {
				code: 4001,
			}),
		);
		expect(isUserDecision(refusal!)).toBe(false);
	});
});

describe('refusalExplanation: what the app says about each reason', () => {
	const say = (reason: ConnectionFailureReason, cause?: unknown) =>
		refusalExplanation(
			connectionRefusal(failure('library words', reason, cause))!,
		);

	it('answers a declined required permission with how to fix it', () => {
		expect(say('host-refused', PERMISSION_DENIED)).toMatch(/allow it/i);
	});

	it("uses the host's own words for a host refusal it has no words for", () => {
		// The host picks its own vocabulary and may gain a reason this app has
		// never heard of. Substituting a guess would be inventing a diagnosis.
		expect(
			say('host-refused', {message: 'refused for a reason from the future'}),
		).toBe('refused for a reason from the future');
	});

	it('does not call an empty wallet a refusal', () => {
		// `no-accounts` looks like someone declined and is not: nobody declined
		// anything, the wallet has nothing to offer. "You are not signed in" would
		// send the user back to a button that cannot help them.
		const sentence = say('no-accounts');
		expect(sentence).toMatch(/did not offer any account/i);
		expect(sentence).not.toMatch(/not signed in/i);
	});

	it('does not invite a retry where one cannot succeed', () => {
		// The consent lives in the wallet host's allowlist, so pressing the same
		// button again cannot change the answer.
		expect(say('cross-origin-blocked', CROSS_ORIGIN_BLOCKED)).toMatch(
			/will not change that/i,
		);
	});

	it('falls back to the library words for a reason added in a minor release', () => {
		// The library states plainly that new members arrive in MINOR versions, so
		// the default branch is load-bearing rather than defensive. Falling
		// through to "you are not signed in" would state something unknown.
		expect(say('a-reason-from-the-future' as ConnectionFailureReason)).toBe(
			'library words',
		);
	});
});

describe('the modal and the caught error cannot disagree', () => {
	it('classifies a resting error the same way as the rejection', () => {
		// The library copies the resting error's reason onto the thrown failure
		// precisely so these two cannot tell the user different stories.
		const error = {
			message: CROSS_ORIGIN_BLOCKED.message,
			cause: CROSS_ORIGIN_BLOCKED,
			reason: 'cross-origin-blocked' as const,
		};

		expect(restingRefusal(error)).toEqual(
			connectionRefusal(failure(error.message, error.reason, error.cause)),
		);
	});

	it('has nothing to say when nothing is resting on the connection', () => {
		expect(restingRefusal(undefined)).toBeUndefined();
		expect(connectionFailureView(undefined)).toBeUndefined();
	});

	it('names the misconfiguration for a blocked origin, both ways round', () => {
		const view = connectionFailureView({
			message: CROSS_ORIGIN_BLOCKED.message,
			cause: CROSS_ORIGIN_BLOCKED,
			reason: 'cross-origin-blocked',
		});

		expect(view?.title).toBe('This site cannot use that account');
		expect(view?.detail).toBe(
			'https://game.example requesting https://wallet.example',
		);
	});

	it('reports an unreachable connection rather than showing a blank failure', () => {
		const view = connectionFailureView({
			message: 'could not reach WalletConnected',
			reason: 'unreachable',
		});

		expect(view?.title).toBe('Connection Failed');
		expect(view?.message).toMatch(/nothing is in progress/i);
	});
});
