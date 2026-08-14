import {describe, it, expect} from 'vitest';
import {ConnectionFailure} from '@etherplay/connect';
import {
	connectionFailureView,
	connectionRefusal,
	refusalExplanation,
	restingRefusal,
} from '$lib/core/connection/refusal';

/**
 * The two refusal objects, exactly as the WALLET HOST posts them.
 *
 * Written out here rather than imported, because they are not this library's
 * types: they cross an origin boundary as JSON, and one of them
 * (`permission-denied`) is minted by the host application, which this repo does
 * not depend on at all. A fixture built from a shared type would agree with
 * itself while the wire disagreed.
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

describe('connectionRefusal: why ensureConnected rejected', () => {
	it('reads a declined required permission, and keeps the outcomes', () => {
		const refusal = connectionRefusal(
			new ConnectionFailure(PERMISSION_DENIED.message, PERMISSION_DENIED),
		);

		expect(refusal?.kind).toBe('permission-denied');
		// Carried rather than dropped: a descendant declaring several permissions
		// needs to be able to name the one that blocked sign-in.
		expect(
			refusal?.kind === 'permission-denied' ? refusal.permissions : [],
		).toHaveLength(1);
	});

	it('reads a blocked origin, and both origins with it', () => {
		const refusal = connectionRefusal(
			new ConnectionFailure(CROSS_ORIGIN_BLOCKED.message, CROSS_ORIGIN_BLOCKED),
		);

		expect(refusal).toEqual({
			kind: 'cross-origin-blocked',
			windowOrigin: 'https://game.example',
			signingOrigin: 'https://wallet.example',
		});
	});

	it('reads a failure with nothing attached as the user backing out', () => {
		// The whole of the distinction: every failure path in the library attaches
		// what went wrong, and the cancellation paths have nothing to attach
		// because closing a popup is an answer rather than a fault. Read off the
		// absence, never off the wording, which upstream is free to rephrase.
		expect(
			connectionRefusal(new ConnectionFailure('Connection cancelled')),
		).toEqual({kind: 'cancelled'});
	});

	it('keeps a wallet error as itself, in the wallet\u2019s own words', () => {
		// A rejected wallet prompt still arrives as an EIP-1193 error on the cause,
		// which `isUserRejectionError` reads by its 4001. Nothing here should
		// flatten it into one of the host refusals.
		const refusal = connectionRefusal(
			new ConnectionFailure('Connection request was declined.', {
				code: 4001,
				message: 'User rejected the request',
			}),
		);

		expect(refusal).toEqual({
			kind: 'other',
			message: 'User rejected the request',
		});
	});

	it('never reads a reason it does not understand as a cancellation', () => {
		// A refusal type this app has never heard of means the host gained one and
		// this classifier did not. Answering "the user backed out" would silence a
		// real refusal, and silence is the one response that cannot be corrected
		// later; `other` at least says the host's own words out loud.
		const refusal = connectionRefusal(
			new ConnectionFailure('sign in failed', {
				type: 'something-invented-later',
				message: 'the host refused for a reason from the future',
			}),
		);

		expect(refusal).toEqual({
			kind: 'other',
			message: 'the host refused for a reason from the future',
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

describe('restingRefusal: why the connection is sitting on an error', () => {
	it('classifies the same cause the rejection carries', () => {
		// ONE OBJECT, TWO SURFACES: the library sets `connection.error = {message,
		// cause}` and rejects with `new ConnectionFailure(message, cause)`, so both
		// entry points must reach the same answer or the modal and the call site
		// can disagree about what happened.
		const error = {
			message: CROSS_ORIGIN_BLOCKED.message,
			cause: CROSS_ORIGIN_BLOCKED,
		};

		expect(restingRefusal(error)).toEqual(
			connectionRefusal(new ConnectionFailure(error.message, error.cause)),
		);
	});

	it('has nothing to say when the connection carries no error', () => {
		expect(restingRefusal(undefined)).toBeUndefined();
	});
});

describe('refusalExplanation: one sentence per reason', () => {
	it('tells a declined permission from a blocked origin', () => {
		const denied = refusalExplanation({
			kind: 'permission-denied',
			permissions: [],
		});
		const blocked = refusalExplanation({
			kind: 'cross-origin-blocked',
			windowOrigin: 'https://game.example',
			signingOrigin: 'https://wallet.example',
		});

		expect(denied).not.toBe(blocked);
		// Neither is the cancellation wording, which is the whole point of 0.6.0
		// carrying the reason back at all.
		expect(denied.toLowerCase()).not.toContain('cancel');
		expect(blocked.toLowerCase()).not.toContain('cancel');
	});

	it('names the declined permission as the user\u2019s to reconsider', () => {
		const denied = refusalExplanation({
			kind: 'permission-denied',
			permissions: [],
		});
		expect(denied).toContain('declined');
		expect(denied).toContain('Sign in again');
	});

	it('says a blocked origin cannot be retried, and is not the user\u2019s fault', () => {
		// The remedy lives in the wallet host's allowlist, which no amount of
		// pressing a button on this page can reach. A sentence that implied
		// otherwise would send someone looking for a setting that is not there.
		const blocked = refusalExplanation({
			kind: 'cross-origin-blocked',
			windowOrigin: 'https://game.example',
			signingOrigin: 'https://wallet.example',
		});

		expect(blocked).toContain('https://wallet.example');
		expect(blocked).toContain('trying again will not change that');
		expect(blocked).toContain('not anything you did');
	});
});

describe('connectionFailureView: what the connection\u2019s own modal says', () => {
	it('answers a declined permission in the app\u2019s words, not the host\u2019s', () => {
		const view = connectionFailureView({
			message: PERMISSION_DENIED.message,
			cause: PERMISSION_DENIED,
		});

		expect(view?.title).toBe('Not signed in');
		// The host's message ("a required permission was denied") is written for a
		// developer reading a console.
		expect(view?.message).not.toBe(PERMISSION_DENIED.message);
		expect(view?.detail).toBeUndefined();
	});

	it('puts both origins under a blocked request, for whoever has to fix it', () => {
		const view = connectionFailureView({
			message: CROSS_ORIGIN_BLOCKED.message,
			cause: CROSS_ORIGIN_BLOCKED,
		});

		expect(view?.title).toBe('This site cannot use that account');
		// Side by side, which the library notes is the whole diagnosis: an app
		// landing here has almost always misconfigured `signingOrigin`, and the two
		// strings together say which way round.
		expect(view?.detail).toBe(
			'https://game.example requesting https://wallet.example',
		);
	});

	it('leaves an ordinary wallet failure exactly as it was', () => {
		// Unchanged from before 0.6.0: a wallet's own words about a wallet's own
		// problem beat anything this app could substitute for them.
		expect(
			connectionFailureView({message: 'could not get any accounts'}),
		).toEqual({
			title: 'Connection Failed',
			message: 'could not get any accounts',
		});
	});

	it('opens nothing when the connection is resting cleanly', () => {
		expect(connectionFailureView(undefined)).toBeUndefined();
	});
});
