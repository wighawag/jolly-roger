import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {revokeDelegation, type RevokeDeps} from '$lib/ui/delegation/revoke';

const OWNER = '0x00000000000000000000000000000000000000dD' as const;
const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const REGISTRY = '0x00000000000000000000000000000000000000eE' as const;

/** What the executor's client is called with; typed so a test can read it back. */
type WriteCall = {
	address: `0x${string}`;
	functionName: string;
	args: unknown[];
	account: `0x${string}`;
};

function deps(params: {canSend?: boolean; signedIn?: boolean} = {}) {
	// Typed argument, so the call is readable back: an untyped vi.fn() records
	// calls as an empty tuple.
	const writeContract = vi.fn(async (_args: WriteCall) => '0xhash' as const);
	const delegationUpdate = vi.fn(async () => ({
		step: 'Loaded' as const,
		allowed: false,
		withdrawn: true,
	}));

	return {
		writeContract,
		delegationUpdate,
		deps: {
			connection: writable(
				(params.signedIn ?? true)
					? {
							step: 'SignedIn',
							account: {address: OWNER, signer: {address: SIGNER}},
						}
					: {step: 'Idle'},
			),
			accountExecutor: writable(
				(params.canSend ?? true)
					? {
							status: 'ready',
							address: OWNER,
							account: OWNER,
							client: {writeContract},
						}
					: {status: 'cannot-send'},
			),
			publicClient: {
				waitForTransactionReceipt: vi.fn(async () => ({status: 'success'})),
			},
			delegation: Object.assign(
				writable({step: 'Loaded', allowed: true, withdrawn: false}),
				{
					update: delegationUpdate,
					registry: {chainId: 31337, address: REGISTRY, abi: []},
				},
			),
		} as unknown as RevokeDeps,
	};
}

/**
 * Withdrawing this browser's authority.
 *
 * THE REASON THE MECHANISM IS SAFE TO OFFER AT ALL, so the thing worth pinning
 * is that it names the right delegate: an account may have several now, and
 * revoking the wrong one would leave the user's access exactly where it was
 * while telling them it had been withdrawn.
 */
describe('revokeDelegation', () => {
	it('withdraws THIS browser, by name, at the contract it was read from', async () => {
		const {deps: d, writeContract, delegationUpdate} = deps();

		const result = await revokeDelegation(d);

		expect(result).toEqual({status: 'revoked'});
		const call = writeContract.mock.calls[0][0];
		expect(call.functionName).toBe('revokeDelegate');
		// The signer, not a bare call: `revokeDelegate()` with no argument could
		// only have meant "whichever one the contract thinks is current", which
		// under a set of delegates is not a question with an answer.
		expect(call.args).toEqual([SIGNER]);
		// The contract the state was READ from, so the panel cannot end up
		// reporting an authorisation that is still live somewhere else.
		expect(call.address).toBe(REGISTRY);
		// Sent BY the owner: the contract takes `msg.sender` as the account
		// withdrawing, so nobody can withdraw on its behalf.
		expect(call.account).toBe(OWNER);
		// And the read is refreshed, so the panel says what is true rather than
		// what was true when the button was pressed.
		expect(delegationUpdate).toHaveBeenCalled();
	});

	it('says so when the account has no wallet to send with', async () => {
		const {deps: d, writeContract} = deps({canSend: false});

		expect(await revokeDelegation(d)).toEqual({status: 'cannot-send'});
		expect(writeContract).not.toHaveBeenCalled();
	});

	it('does nothing when nobody is signed in', async () => {
		// There is no signer to withdraw, so there is nothing to send. Treated as
		// a cancellation rather than an error: the user cannot act on it, and it
		// only happens if the session ended under an open panel.
		const {deps: d, writeContract} = deps({signedIn: false});

		expect(await revokeDelegation(d)).toEqual({status: 'cancelled'});
		expect(writeContract).not.toHaveBeenCalled();
	});
});
