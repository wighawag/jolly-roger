import {describe, it, expect} from 'vitest';
import {delegationMessage} from '@etherplay/connect';
import type {PermissionOutcome} from '@etherplay/connect';
import {
	chooseRegistrationRoute,
	credentialExpired,
	credentialState,
	registrationRequest,
	sameAddress,
	signsOnDemand,
	type CredentialState,
} from '$lib/ui/delegation/registration';

const OWNER = '0x00000000000000000000000000000000000000dD' as const;
const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const PAYER = '0x00000000000000000000000000000000000000bB' as const;
const CONTRACT = '0x00000000000000000000000000000000000000eE' as const;
const OTHER_CONTRACT = '0x00000000000000000000000000000000000000fF' as const;
const SIGNATURE = `0x${'ab'.repeat(65)}` as const;
const CHAIN_ID = 31337;
const TARGET = {chainId: CHAIN_ID, contract: CONTRACT};

const held: CredentialState = {kind: 'held'};

/**
 * What a hosted-capable connection reports when the owner turns out to be a
 * wallet: every declared entry comes back refused, for a reason that is not a
 * refusal at all.
 */
const signOnDemandOutcome: PermissionOutcome = {
	request: {
		type: 'delegation',
		required: false,
		chainId: CHAIN_ID,
		contract: CONTRACT,
	},
	granted: false,
	reason: 'sign-on-demand',
};

/**
 * The decision is TWO questions, not three account types: who pays, and how the
 * authorisation is proven. These pin the second one.
 */
const base = {
	owner: OWNER,
	payer: PAYER,
	ownerCanSend: true,
	credential: {kind: 'none'} as CredentialState,
	ownerCanSignLive: true,
	withdrawn: false,
};

describe('chooseRegistrationRoute: how the authorisation is proven', () => {
	it('takes the direct route when the payer IS the owner', () => {
		// Collapsing the redundant case: asking someone to sign a message
		// authorising a key and then to send a transaction from that same account
		// is asking twice for one decision.
		expect(chooseRegistrationRoute({...base, payer: OWNER})).toEqual({
			kind: 'direct',
		});
	});

	it('matches the payer to the owner regardless of address casing', () => {
		expect(
			chooseRegistrationRoute({
				...base,
				payer: OWNER.toLowerCase() as `0x${string}`,
			}),
		).toEqual({kind: 'direct'});
	});

	it('does NOT take it when the owner cannot send, however the addresses look', () => {
		// Guarded on the capability, not on address equality. A hosted account can
		// never be the payer anyway, since it holds no wallet and cannot submit.
		const route = chooseRegistrationRoute({
			...base,
			payer: OWNER,
			ownerCanSend: false,
			ownerCanSignLive: false,
			credential: held,
		});
		expect(route).toEqual({kind: 'pre-signed'});
	});

	it('takes the pre-signed route when a credential exists and nobody can be asked', () => {
		// Detected by ASKING what the connection holds for this contract.
		// Inferring it from the account type would encode an assumption about
		// which mechanisms pre-sign.
		//
		// The route carries no bytes. It decides what to SAY (nothing to prompt,
		// so no consent step and no wallet), while the bytes come from
		// `getDelegation` at the moment of submission, which is the only place a
		// credential is ever obtained.
		expect(
			chooseRegistrationRoute({
				...base,
				ownerCanSignLive: false,
				credential: held,
			}),
		).toEqual({kind: 'pre-signed'});
	});

	it('prefers asking the owner over any stored credential', () => {
		// The same question the library asks: `getDelegation` signs live when the
		// owner is a wallet, whatever is stored. Deciding it here on "is there a
		// record" instead would let the two disagree, and a `pre-signed` route
		// that quietly opens a wallet has no consent step and no account check in
		// front of it.
		expect(chooseRegistrationRoute({...base, credential: held})).toEqual({
			kind: 'live-signature',
		});
	});

	it('asks the wallet to sign when it is on hand, whatever is stored', () => {
		expect(chooseRegistrationRoute(base)).toEqual({kind: 'live-signature'});
		// Even with a spent credential: an owner that can be asked has no reason
		// to sign in again.
		expect(
			chooseRegistrationRoute({...base, credential: {kind: 'stale'}}),
		).toEqual({kind: 'live-signature'});
	});

	it('sends an account that cannot sign live back to sign in again', () => {
		// ONE route, because the remedy is the same in all three cases: a hosted
		// account mints its credentials at sign-in, so that is where another one
		// comes from.
		const reasonFor = (credential: CredentialState) =>
			chooseRegistrationRoute({
				...base,
				ownerCanSend: false,
				ownerCanSignLive: false,
				credential,
			});

		expect(reasonFor({kind: 'stale'})).toEqual({
			kind: 're-authorise',
			reason: 'expired',
		});
		expect(reasonFor({kind: 'denied'})).toEqual({
			kind: 're-authorise',
			reason: 'denied',
		});
		// A misconfiguration of the app, and named as one rather than blamed on
		// the user, who declined nothing.
		expect(reasonFor({kind: 'none'})).toEqual({
			kind: 're-authorise',
			reason: 'not-requested',
		});
	});

	it('has nothing to offer when the wallet did not understand the request', () => {
		// Signing in again cannot help: the wallet refused because it cannot
		// describe what was asked for, so `unavailable` keeps its meaning of
		// "nothing the user does from here can work".
		const route = chooseRegistrationRoute({
			...base,
			ownerCanSend: false,
			ownerCanSignLive: false,
			credential: {kind: 'unsupported'},
		});
		expect(route.kind).toBe('unavailable');
	});

	it('closes the signature routes once the owner has withdrawn this signer', () => {
		// The withdrawn flag is per delegate: cleared only by an owner-sent
		// registerDelegate, so a signature carrying no nonce cannot undo a
		// revocation of that delegate.
		const route = chooseRegistrationRoute({
			...base,
			withdrawn: true,
			credential: held,
		});
		expect(route.kind).toBe('unavailable');
	});

	it('still lets a withdrawn owner re-authorise by sending it themselves', () => {
		// An account that CAN revoke has a wallet by definition, so this route is
		// always open to it, and the re-registration dead end for that delegate
		// never exists.
		expect(
			chooseRegistrationRoute({...base, payer: OWNER, withdrawn: true}),
		).toEqual({kind: 'direct'});
	});

	it('has nothing to do before anybody is signed in', () => {
		expect(chooseRegistrationRoute({...base, owner: undefined}).kind).toBe(
			'unavailable',
		);
	});
});

describe('credentialState: what the connection holds for ONE contract', () => {
	const saved = {
		chainId: CHAIN_ID,
		contract: CONTRACT,
		delegate: SIGNER,
		deadline: 0,
		signature: SIGNATURE,
	};

	it('picks the record for this (chain, contract) and no other', () => {
		expect(
			credentialState({
				savedDelegations: [
					{...saved, contract: OTHER_CONTRACT},
					{...saved, chainId: 1},
					saved,
				],
				permissions: undefined,
				target: TARGET,
				delegate: SIGNER,
			}),
		).toEqual({kind: 'held'});
	});

	it('matches the contract case-insensitively, since spelling is presentation', () => {
		expect(
			credentialState({
				savedDelegations: [
					{...saved, contract: CONTRACT.toLowerCase() as `0x${string}`},
				],
				permissions: undefined,
				target: TARGET,
				delegate: SIGNER,
			}).kind,
		).toBe('held');
	});

	it('will not submit a credential made for a different delegate', () => {
		// `delegate` is redundant with what is inside the signature, and that is
		// the point: it catches the mismatch here rather than by registering
		// somebody else's key with the user's money.
		expect(
			credentialState({
				savedDelegations: [{...saved, delegate: PAYER}],
				permissions: undefined,
				target: TARGET,
				delegate: SIGNER,
			}),
		).toEqual({kind: 'stale'});
	});

	it('treats one past its deadline as spent', () => {
		expect(
			credentialState({
				savedDelegations: [{...saved, deadline: 1}],
				permissions: undefined,
				target: TARGET,
				delegate: SIGNER,
			}),
		).toEqual({kind: 'stale'});
	});

	it('never picks a signature the contract has already refused', () => {
		// The record belongs to the wallet and the app cannot delete it, so a
		// refusal has to stick HERE or the next run picks the same doomed
		// credential and fails the same way. Without this, "self-healing" would
		// mean "healing if the user does as they are told".
		expect(
			credentialState({
				savedDelegations: [saved],
				permissions: undefined,
				target: TARGET,
				delegate: SIGNER,
				refused: new Set([SIGNATURE]),
			}),
		).toEqual({kind: 'stale'});
	});

	it('tells a refusal apart from a question nobody asked', () => {
		// The whole reason `permissions` exists: an absent credential says
		// neither, and the two call for different sentences.
		const outcomeFor = (reason: 'denied' | 'unsupported') =>
			credentialState({
				savedDelegations: [],
				permissions: [
					{
						request: {
							type: 'delegation',
							required: false,
							chainId: CHAIN_ID,
							contract: CONTRACT,
						},
						granted: false,
						reason,
					},
				],
				target: TARGET,
				delegate: SIGNER,
			});

		expect(outcomeFor('denied')).toEqual({kind: 'denied'});
		expect(outcomeFor('unsupported')).toEqual({kind: 'unsupported'});
		expect(
			credentialState({
				savedDelegations: [],
				permissions: [],
				target: TARGET,
				delegate: SIGNER,
			}),
		).toEqual({kind: 'none'});
	});

	it('reports an owner that signs on demand as having no credential', () => {
		// Which is true: nothing was pre-generated. That the owner can be ASKED is
		// a fact about the owner, and it is read separately - see signsOnDemand.
		// The trap this avoids is the reason arriving as `granted: false`, where
		// reading the flag alone would offer a re-authorisation to a user who
		// declined nothing.
		expect(
			credentialState({
				savedDelegations: [],
				permissions: [signOnDemandOutcome],
				target: TARGET,
				delegate: SIGNER,
			}),
		).toEqual({kind: 'none'});
	});

	it('ignores an outcome about a different contract', () => {
		expect(
			credentialState({
				savedDelegations: [],
				permissions: [
					{
						request: {
							type: 'delegation',
							required: false,
							chainId: CHAIN_ID,
							contract: OTHER_CONTRACT,
						},
						granted: false,
						reason: 'denied',
					},
				],
				target: TARGET,
				delegate: SIGNER,
			}),
		).toEqual({kind: 'none'});
	});
});

describe('credentialExpired: the browser clock, with a margin', () => {
	const now = 1_700_000_000_000; // ms

	it('never expires a deadline of zero, which is the absence of one', () => {
		// The bug the vectors pin against: a falsy deadline is not an absent one.
		expect(credentialExpired(0, now)).toBe(false);
		expect(credentialExpired(1, now)).toBe(true);
	});

	it('treats one about to lapse as already spent', () => {
		// Between reading the clock and the transaction being mined there is a
		// wallet prompt, a network and a block. The margin is the difference
		// between saying so here and a revert after the user has paid the gas.
		const inSeconds = Math.floor(now / 1000);
		expect(credentialExpired(inSeconds + 30, now)).toBe(true);
		expect(credentialExpired(inSeconds + 3600, now)).toBe(false);
	});
});

describe('registrationRequest: which entry point, and what it forwards', () => {
	it('registers directly when the owner is sending, with the delegate as payee', () => {
		const request = registrationRequest({
			owner: OWNER,
			delegate: SIGNER,
			value: 1000n,
		});

		expect(request.functionName).toBe('registerDelegate');
		expect(request.args).toEqual([SIGNER, SIGNER]);
		expect(request.value).toBe(1000n);
	});

	it('registers by signature when one is supplied, deadline included', () => {
		const request = registrationRequest({
			owner: OWNER,
			delegate: SIGNER,
			value: 1000n,
			credential: {signature: SIGNATURE, deadline: 1893456000},
		});

		expect(request.functionName).toBe('registerDelegateViaSignature');
		// No origin, and no contract or chain either: those two the contract reads
		// off `address(this)` and `block.chainid`, which is what stops a caller
		// choosing them.
		expect(request.args).toEqual([OWNER, SIGNER, 1893456000n, SIGNATURE]);
	});

	it('never names the zero address as payee, which would revert on value', () => {
		// Payments.forward reverts on value with a zero payee rather than quietly
		// keeping money nobody could recover.
		expect(() =>
			registrationRequest({
				owner: OWNER,
				delegate: '0x0000000000000000000000000000000000000000',
				value: 1000n,
			}),
		).toThrow(/zero address/);
	});
});

describe('the message an owner signs', () => {
	it('comes from the library that the contract is pinned against', () => {
		// Never hand-rolled here. The wording, the field order and the address
		// casing are consensus between Delegation.message in Solidity, this
		// builder and the vectors file both are tested against; changing either
		// invalidates every signature ever produced, silently. This asserts only
		// that the app has not started building its own.
		const message = delegationMessage({
			delegate: SIGNER,
			contract: CONTRACT,
			chainId: CHAIN_ID,
			deadline: 0,
		});
		expect(message).toContain(SIGNER.toLowerCase());
		expect(message).toContain(CONTRACT.toLowerCase());
		expect(message).toContain(`Chain ID: ${CHAIN_ID}`);
		expect(message).toContain('Expires: never');
		expect(message).not.toContain(SIGNER);
	});
});

describe('signsOnDemand: the owner is a live signer, said by the host', () => {
	it('is true only for a sign-on-demand outcome about THIS pair', () => {
		expect(signsOnDemand([signOnDemandOutcome], TARGET)).toBe(true);
		expect(
			signsOnDemand(
				[
					{
						...signOnDemandOutcome,
						request: {
							type: 'delegation',
							required: false,
							chainId: CHAIN_ID,
							contract: OTHER_CONTRACT,
						},
					},
				],
				TARGET,
			),
		).toBe(false);
	});

	it('is false for a refusal, and for nothing at all', () => {
		// A denial is not an offer to sign later, and silence is not either.
		expect(
			signsOnDemand(
				[{...signOnDemandOutcome, granted: false, reason: 'denied'}],
				TARGET,
			),
		).toBe(false);
		expect(signsOnDemand(undefined, TARGET)).toBe(false);
		expect(signsOnDemand([], TARGET)).toBe(false);
	});
});

describe('sameAddress', () => {
	it('ignores casing, and treats a missing address as no match', () => {
		expect(sameAddress(OWNER, OWNER.toLowerCase() as `0x${string}`)).toBe(true);
		expect(sameAddress(OWNER, PAYER)).toBe(false);
		expect(sameAddress(undefined, OWNER)).toBe(false);
		expect(sameAddress(undefined, undefined)).toBe(false);
	});
});
