import {describe, it, expect, vi} from 'vitest';
import {
	fetchDelegation,
	isCredentialRejection,
	type DelegationSource,
} from '$lib/ui/delegation/register-delegate';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const OTHER = '0x00000000000000000000000000000000000000bB' as const;
const CONTRACT = '0x00000000000000000000000000000000000000eE' as const;
const SIGNATURE = `0x${'ab'.repeat(65)}` as const;
const TARGET = {chainId: 31337, contract: CONTRACT};

/** A connection that hands back whatever record the test wants to describe. */
function sourceReturning(record: {
	chainId: number;
	contract: `0x${string}`;
	delegate: `0x${string}`;
	deadline: number;
	signature: `0x${string}`;
}) {
	// Typed argument, so the call is readable back: an untyped vi.fn() records
	// calls as an empty tuple.
	const getDelegation = vi.fn(
		async (_target: {
			chainId: number;
			contract: `0x${string}`;
			deadline?: number;
		}) => record,
	);
	return {
		getDelegation,
		connection: {getDelegation} as unknown as DelegationSource,
	};
}

/**
 * Getting the credential, from whichever kind of owner.
 *
 * The bytes are the library's business (and the package's vectors pin them).
 * What this file pins is the app's half: that it asks about the pair it means
 * to write to, and that it refuses to submit a record describing anything else.
 */
describe('fetchDelegation', () => {
	const good = {
		chainId: 31337,
		contract: CONTRACT,
		delegate: SIGNER,
		deadline: 0,
		signature: SIGNATURE,
	};

	it('asks about the pair, and names no deadline', async () => {
		// Naming one would only match a credential minted with the same one, so
		// asking for zero would reject a hosted record carrying a real date.
		const {connection, getDelegation} = sourceReturning(good);

		await fetchDelegation({connection, target: TARGET, delegate: SIGNER});

		expect(getDelegation).toHaveBeenCalledWith(TARGET);
		expect(getDelegation.mock.calls[0][0]).not.toHaveProperty('deadline');
	});

	it('returns the signature with the deadline it was made over', async () => {
		const {connection} = sourceReturning({...good, deadline: 1893456000});

		expect(
			await fetchDelegation({connection, target: TARGET, delegate: SIGNER}),
		).toEqual({signature: SIGNATURE, deadline: 1893456000});
	});

	it('refuses a record for a different delegate', async () => {
		// The record is self-describing precisely so this is caught here, rather
		// than by spending the user's money authorising an address this browser
		// holds no key for.
		const {connection} = sourceReturning({...good, delegate: OTHER});

		await expect(
			fetchDelegation({connection, target: TARGET, delegate: SIGNER}),
		).rejects.toThrow(/authorises/);
	});

	it('refuses a record for a different contract or chain', async () => {
		// Both are inside the signed bytes, so a record naming either differently
		// produces a signature that verifies nowhere.
		const wrongContract = sourceReturning({...good, contract: OTHER});
		await expect(
			fetchDelegation({
				connection: wrongContract.connection,
				target: TARGET,
				delegate: SIGNER,
			}),
		).rejects.toThrow();

		const wrongChain = sourceReturning({...good, chainId: 1});
		await expect(
			fetchDelegation({
				connection: wrongChain.connection,
				target: TARGET,
				delegate: SIGNER,
			}),
		).rejects.toThrow();
	});

	it('accepts the contract however it is spelled', async () => {
		// The library lowercases what it returns, and an app may hold a
		// checksummed address. Casing is presentation; the chain does not care.
		const {connection} = sourceReturning({
			...good,
			contract: CONTRACT.toLowerCase() as `0x${string}`,
		});

		await expect(
			fetchDelegation({connection, target: TARGET, delegate: SIGNER}),
		).resolves.toEqual({signature: SIGNATURE, deadline: 0});
	});
});

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
