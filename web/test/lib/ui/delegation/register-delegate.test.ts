import {describe, it, expect} from 'vitest';
import {isCredentialRejection} from '$lib/ui/delegation/register-delegate';

/**
 * Telling "this credential will never be accepted" apart from "this call
 * failed".
 *
 * The distinction is the whole of the self-healing story: a stored record that
 * disagrees with the bytes it was cut from cannot be detected locally at all,
 * so the contract refusing it is the ONLY signal there is, and reporting that
 * as a contract error would leave the user retrying a transaction that can
 * never succeed.
 *
 * Both shapes are covered because both really happen: viem decodes the revert
 * against DELEGATION_ABI when it can, and hands back a flattened Error when an
 * intermediate layer got there first.
 */
describe('isCredentialRejection', () => {
	it('recognises the decoded error name, however deeply wrapped', () => {
		expect(
			isCredentialRejection(
				Object.assign(new Error('An unknown RPC error occurred'), {
					cause: Object.assign(new Error('execution reverted'), {
						cause: {data: {errorName: 'SignatureExpired'}},
					}),
				}),
			),
		).toBe(true);
	});

	it('recognises the name in prose, wherever viem put the wording', () => {
		// `shortMessage` and `details`, not `message` alone: viem spreads the
		// wording across all three depending on how far up the wrapping you are,
		// and reading one of them was how this went wrong before.
		expect(
			isCredentialRejection({
				shortMessage: 'The contract function reverted with InvalidSignature()',
			}),
		).toBe(true);
		expect(
			isCredentialRejection({details: 'reverted: UnrecoverableSignature()'}),
		).toBe(true);
		expect(
			isCredentialRejection(new Error('reverted with MalformedSignature()')),
		).toBe(true);
	});

	it('leaves every other failure to be reported as itself', () => {
		// A missed match costs a generic error message; a wrong one sends the user
		// off to sign in again for a problem signing in cannot fix.
		expect(isCredentialRejection(new Error('insufficient funds'))).toBe(false);
		expect(
			isCredentialRejection({
				cause: {data: {errorName: 'DelegationWithdrawn'}},
			}),
		).toBe(false);
	});

	it('answers rather than throwing, whatever was thrown', () => {
		// Called from a catch block that is already reporting a failure, so a
		// second error thrown over the first would replace something the user
		// could act on with nothing.
		expect(isCredentialRejection(undefined)).toBe(false);
		expect(isCredentialRejection(null)).toBe(false);
		expect(isCredentialRejection('InvalidSignature')).toBe(true);
		expect(isCredentialRejection(42)).toBe(false);
	});

	it('terminates on a cause chain that loops', () => {
		const first: {message: string; cause?: unknown} = {message: 'first'};
		const second = {message: 'second', cause: first};
		first.cause = second;
		expect(isCredentialRejection(first)).toBe(false);
	});
});
