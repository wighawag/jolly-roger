import {describe, it, expect} from 'vitest';
import {originDelegationMessage} from '@etherplay/connect';
import {
	chooseRegistrationRoute,
	delegationMessage,
	registrationRequest,
	sameAddress,
} from '$lib/ui/delegation/registration';

const OWNER = '0x00000000000000000000000000000000000000dD' as const;
const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const PAYER = '0x00000000000000000000000000000000000000bB' as const;
const SIGNATURE = `0x${'ab'.repeat(65)}` as const;
const ORIGIN = 'https://greetings.test';

/**
 * The decision is TWO questions, not three account types: who pays, and how the
 * authorisation is proven. These pin the second one.
 */
const base = {
	owner: OWNER,
	payer: PAYER,
	ownerCanSend: true,
	savedSignature: undefined,
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
			savedSignature: SIGNATURE,
		});
		expect(route).toEqual({kind: 'pre-signed', signature: SIGNATURE});
	});

	it('uses a signature the connection already carries, with nothing to prompt', () => {
		// Detected by ASKING whether the signature is there. Inferring it from the
		// account type would encode an assumption about which mechanisms pre-sign.
		expect(
			chooseRegistrationRoute({...base, savedSignature: SIGNATURE}),
		).toEqual({kind: 'pre-signed', signature: SIGNATURE});
	});

	it('asks the wallet to sign when there is no saved signature', () => {
		expect(chooseRegistrationRoute(base)).toEqual({kind: 'live-signature'});
	});

	it('has nothing to offer when the owner can neither send nor sign', () => {
		const route = chooseRegistrationRoute({
			...base,
			ownerCanSend: false,
			ownerCanSignLive: false,
		});
		expect(route.kind).toBe('unavailable');
	});

	it('closes both signature routes once the owner has withdrawn access', () => {
		// `delegationWithdrawn` is cleared only by an owner-sent registerDelegate,
		// precisely so a signature carrying no nonce cannot undo a revocation.
		const route = chooseRegistrationRoute({
			...base,
			withdrawn: true,
			savedSignature: SIGNATURE,
		});
		expect(route.kind).toBe('unavailable');
	});

	it('still lets a withdrawn owner re-authorise by sending it themselves', () => {
		// An account that CAN revoke has a wallet by definition, so this route is
		// always open to it, and the re-registration dead end never exists.
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

describe('registrationRequest: which entry point, and what it forwards', () => {
	it('registers directly when the owner is sending, with the delegate as payee', () => {
		const request = registrationRequest({
			owner: OWNER,
			origin: ORIGIN,
			delegate: SIGNER,
			value: 1000n,
		});

		expect(request.functionName).toBe('registerDelegate');
		expect(request.args).toEqual([SIGNER, SIGNER]);
		expect(request.value).toBe(1000n);
	});

	it('registers by signature when one is supplied', () => {
		const request = registrationRequest({
			owner: OWNER,
			origin: ORIGIN,
			delegate: SIGNER,
			value: 1000n,
			signature: SIGNATURE,
		});

		expect(request.functionName).toBe('registerDelegateViaSignature');
		expect(request.args).toEqual([OWNER, ORIGIN, SIGNER, SIGNATURE]);
	});

	it('never names the zero address as payee, which would revert on value', () => {
		// Payments.forward reverts on value with a zero payee rather than quietly
		// keeping money nobody could recover.
		expect(() =>
			registrationRequest({
				owner: OWNER,
				origin: ORIGIN,
				delegate: '0x0000000000000000000000000000000000000000',
				value: 1000n,
			}),
		).toThrow(/zero address/);
	});
});

describe('delegationMessage: the text the contract verifies', () => {
	it('is the library builder, verbatim', () => {
		// Never hand-rolled. The wording and the address casing are consensus with
		// Delegation.message in Solidity; changing either invalidates every
		// signature ever produced, silently.
		expect(delegationMessage(ORIGIN, SIGNER)).toBe(
			originDelegationMessage(ORIGIN, SIGNER),
		);
	});

	it('lowercases the delegate, because that is what the contract renders', () => {
		expect(delegationMessage(ORIGIN, SIGNER)).toContain(SIGNER.toLowerCase());
		expect(delegationMessage(ORIGIN, SIGNER)).not.toContain(SIGNER);
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
