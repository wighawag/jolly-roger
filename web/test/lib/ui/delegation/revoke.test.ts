import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {
	revokeDelegation,
	planWithdrawal,
	lowBalanceQuestion,
	withdrawnMessage,
	type RevokeDeps,
} from '$lib/ui/delegation/revoke';
import type {ConfirmationStore} from '$lib/core/ui/confirm/confirmation';

const OWNER = '0x00000000000000000000000000000000000000dD' as const;
const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const REGISTRY = '0x00000000000000000000000000000000000000eE' as const;

const GWEI = 1_000_000_000n;
const ETHER = 10n ** 18n;
const FEES = {maxFeePerGas: 2n * GWEI, maxPriorityFeePerGas: GWEI};
const RESIGN_GAS = 50_000n;
/** The gas limit sent: the estimate plus 10%. */
const RESIGN_LIMIT = 55_000n;

/** What an executor's client is called with; typed so a test can read it back. */
type WriteCall = {
	address: `0x${string}`;
	functionName: string;
	args: unknown[];
	account: `0x${string}`;
	value?: bigint;
	gas?: bigint;
	maxFeePerGas?: bigint;
};

function deps(
	params: {
		canSend?: boolean;
		signedIn?: boolean;
		signerReady?: boolean;
		signerBalance?: bigint;
		accountBalance?: bigint;
		estimateFails?: boolean;
	} = {},
) {
	// Typed argument, so the call is readable back: an untyped vi.fn() records
	// calls as an empty tuple.
	const accountWrite = vi.fn(async (_args: WriteCall) => '0xa' as const);
	const signerWrite = vi.fn(async (_args: WriteCall) => '0xb' as const);
	const delegationUpdate = vi.fn(async () => ({
		step: 'Loaded' as const,
		allowed: false,
		withdrawn: true,
	}));
	const ask = vi.fn(async () => true);
	const balances: Record<string, bigint> = {
		[OWNER]: params.accountBalance ?? ETHER,
		[SIGNER]: params.signerBalance ?? ETHER / 100n,
	};

	return {
		accountWrite,
		signerWrite,
		delegationUpdate,
		ask,
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
							client: {writeContract: accountWrite},
						}
					: {status: 'cannot-send'},
			),
			signerExecutor: writable(
				(params.signerReady ?? true)
					? {
							status: 'ready',
							address: SIGNER,
							account: SIGNER,
							client: {writeContract: signerWrite},
						}
					: {status: 'not-connected'},
			),
			publicClient: {
				estimateFeesPerGas: vi.fn(async () => FEES),
				getBalance: vi.fn(
					async ({address}: {address: string}) => balances[address],
				),
				estimateContractGas: vi.fn(async () => {
					if (params.estimateFails) throw new Error('insufficient funds');
					return RESIGN_GAS;
				}),
				waitForTransactionReceipt: vi.fn(async () => ({status: 'success'})),
			},
			delegation: Object.assign(
				writable({step: 'Loaded', allowed: true, withdrawn: false}),
				{
					update: delegationUpdate,
					registry: {chainId: 31337, address: REGISTRY, abi: []},
				},
			),
			confirmation: {ask},
		} as unknown as RevokeDeps & {confirmation: ConfirmationStore},
	};
}

/**
 * Withdrawing this browser's authority.
 *
 * THE REASON THE MECHANISM IS SAFE TO OFFER AT ALL, so the thing worth pinning
 * is that it names the right delegate: an account may have several, and
 * withdrawing the wrong one would leave the user's access exactly where it was
 * while telling them it had been withdrawn.
 *
 * And, since QA F6 (2026-11-24): that the key's funds come back with it. A
 * withdrawal that left them on a key that could no longer act stranded the
 * user, whose account (its funds having gone to the key) then could not pay to
 * authorise the browser again.
 */
describe('revokeDelegation', () => {
	it('lets THIS browser resign, carrying its balance back to the account', async () => {
		const {deps: d, signerWrite, accountWrite, delegationUpdate} = deps();

		const result = await revokeDelegation(d);

		const sent = ETHER / 100n - RESIGN_LIMIT * FEES.maxFeePerGas;
		expect(result).toEqual({status: 'revoked', by: 'signer', returned: sent});
		expect(accountWrite).not.toHaveBeenCalled();
		const call = signerWrite.mock.calls[0][0];
		expect(call.functionName).toBe('resignDelegate');
		// For THIS owner, and the funds to the owner.
		expect(call.args).toEqual([OWNER, OWNER]);
		// Sent BY the key: no wallet prompt, nothing from the account.
		expect(call.account).toBe(SIGNER);
		// The contract the state was READ from.
		expect(call.address).toBe(REGISTRY);
		// Everything but the gas, at a fee fixed here: the key signs locally, so
		// nothing else picks a fee that the reserve would not cover.
		expect(call.value).toBe(sent);
		expect(call.gas).toBe(RESIGN_LIMIT);
		expect(call.maxFeePerGas).toBe(FEES.maxFeePerGas);
		// And the read is refreshed, so the panel says what is true.
		expect(delegationUpdate).toHaveBeenCalled();
	});

	it('falls back to the account revoking it when the key cannot pay its gas', async () => {
		const {
			deps: d,
			signerWrite,
			accountWrite,
		} = deps({
			signerBalance: RESIGN_LIMIT * FEES.maxFeePerGas - 1n,
		});

		const result = await revokeDelegation(d);

		expect(result).toEqual({status: 'revoked', by: 'account', returned: 0n});
		expect(signerWrite).not.toHaveBeenCalled();
		const call = accountWrite.mock.calls[0][0];
		expect(call.functionName).toBe('revokeDelegate');
		// The signer, by name: an account may have several delegates.
		expect(call.args).toEqual([SIGNER]);
		expect(call.account).toBe(OWNER);
	});

	it('falls back to the account when the resignation cannot even be estimated', async () => {
		const {deps: d, accountWrite} = deps({estimateFails: true});

		expect(await revokeDelegation(d)).toMatchObject({by: 'account'});
		expect(accountWrite).toHaveBeenCalled();
	});

	it('says so when neither the key nor the account can send', async () => {
		const {
			deps: d,
			accountWrite,
			signerWrite,
		} = deps({
			canSend: false,
			signerBalance: 0n,
		});

		expect(await revokeDelegation(d)).toEqual({status: 'cannot-send'});
		expect(accountWrite).not.toHaveBeenCalled();
		expect(signerWrite).not.toHaveBeenCalled();
	});

	it('does nothing when nobody is signed in', async () => {
		// There is no signer to withdraw, so there is nothing to send. Treated as
		// a cancellation rather than an error: the user cannot act on it, and it
		// only happens if the session ended under an open panel.
		const {deps: d, accountWrite, signerWrite} = deps({signedIn: false});

		expect(await revokeDelegation(d)).toEqual({status: 'cancelled'});
		expect(accountWrite).not.toHaveBeenCalled();
		expect(signerWrite).not.toHaveBeenCalled();
	});

	it('acts without asking when the account will still be able to authorise the browser again', async () => {
		const {deps: d, ask} = deps();

		await revokeDelegation(d);

		expect(ask).not.toHaveBeenCalled();
	});

	it('asks first when the account would be left unable to authorise the browser again', async () => {
		// Re-authorising a withdrawn key takes a transaction from the account,
		// so an empty account after the withdrawal is the one consequence worth
		// stopping to say.
		const {
			deps: d,
			ask,
			signerWrite,
		} = deps({
			accountBalance: 0n,
			signerBalance: RESIGN_LIMIT * FEES.maxFeePerGas,
		});
		ask.mockResolvedValueOnce(false);

		expect(await revokeDelegation(d)).toEqual({status: 'cancelled'});
		expect(ask).toHaveBeenCalledTimes(1);
		expect(signerWrite).not.toHaveBeenCalled();
	});

	it('counts the funds coming back when deciding whether the account will be short', async () => {
		const {deps: d} = deps({accountBalance: 0n, signerBalance: ETHER / 100n});

		const planned = await planWithdrawal(d);

		expect(planned).toMatchObject({
			status: 'ready',
			plan: {route: 'resign', lowAfter: false},
		});
	});
});

describe('the words around a withdrawal', () => {
	const words = {
		grant: {action: 'post greetings'},
		symbol: 'ETH',
		decimals: 18,
	};

	it('says what came back', () => {
		expect(
			withdrawnMessage(
				{status: 'revoked', by: 'signer', returned: ETHER / 100n},
				words,
			),
		).toEqual({
			title: 'This browser can no longer post greetings in your name',
			description: '0.01 ETH went back to your account.',
		});
	});

	it('says nothing about funds when none came back', () => {
		expect(
			withdrawnMessage({status: 'revoked', by: 'account', returned: 0n}, words)
				.description,
		).toBeUndefined();
	});

	it('names what the account will hold and why that matters', () => {
		const question = lowBalanceQuestion(
			{
				route: 'revoke',
				owner: OWNER,
				delegate: SIGNER,
				accountAfter: 0n,
				lowAfter: true,
			},
			words,
		);
		expect(question.explanation).toContain('0 ETH');
		expect(question.explanation).toContain('post greetings');
		expect(question.explanation).toContain(
			'takes a transaction from your account',
		);
	});
});
