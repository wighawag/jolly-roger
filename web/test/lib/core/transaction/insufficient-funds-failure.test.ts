import {describe, it, expect} from 'vitest';
import {
	BaseError,
	ContractFunctionExecutionError,
	ContractFunctionRevertedError,
	ExecutionRevertedError,
	InsufficientFundsError as ViemInsufficientFundsError,
	UserRejectedRequestError,
	encodeErrorResult,
} from 'viem';
import {isInsufficientFundsFailure} from '../../../../src/lib/core/transaction/insufficient-funds-failure';
import {InsufficientFundsError} from '../../../../src/lib/core/transaction/InsufficientFundsError';

const doItAbi = [
	{
		type: 'function',
		name: 'doIt',
		inputs: [],
		outputs: [],
		stateMutability: 'nonpayable',
	},
] as const;

/**
 * The wording below is copied from what the nodes actually say, because that is
 * the whole contract this module has: there is no structured signal for "the
 * sender could not pay" on every path, only the node's prose, wrapped several
 * layers deep by viem.
 */
describe('isInsufficientFundsFailure', () => {
	it('matches hardhat', () => {
		expect(
			isInsufficientFundsFailure(
				new Error(
					"Sender doesn't have enough funds to send tx. The max upfront cost is: 100000000000000 and the sender's account only has: 0",
				),
			),
		).toBe(true);
	});

	it('matches geth and the clients that copy it', () => {
		expect(
			isInsufficientFundsFailure(
				new Error(
					'insufficient funds for gas * price + value: address 0x1 have 0 want 21000',
				),
			),
		).toBe(true);
	});

	/**
	 * Each node's message is matched by two independent anchors, one per
	 * sentence half, so that a node rewording one of them does not silently stop
	 * the whole thing working. Each case below isolates ONE anchor: without them
	 * the two tests above pass with half the patterns deleted, and a dead
	 * pattern is indistinguishable from a live one.
	 */
	describe('each anchor holds on its own', () => {
		it('geth, first half: reasons other than gas*price+value', () => {
			// Real geth wording for the transfer case rather than the gas case.
			expect(
				isInsufficientFundsFailure(
					new Error('insufficient funds for transfer'),
				),
			).toBe(true);
		});

		it('geth, second half: the cost formula without the opening words', () => {
			expect(
				isInsufficientFundsFailure(
					new Error('err: gas * price + value exceeds what the address has'),
				),
			).toBe(true);
		});

		it('hardhat, first half, in both spellings of the apostrophe form', () => {
			expect(
				isInsufficientFundsFailure(
					new Error("sender doesn't have enough funds to send tx"),
				),
			).toBe(true);
			expect(
				isInsufficientFundsFailure(
					new Error('sender does not have enough funds to send tx'),
				),
			).toBe(true);
		});

		it('hardhat, second half: the cost report on its own', () => {
			expect(
				isInsufficientFundsFailure(
					new Error(
						"The max upfront cost is: 100000000000000 and the sender's account only has: 0",
					),
				),
			).toBe(true);
		});

		it('the wording viem itself recognises, from besu and nethermind', () => {
			expect(
				isInsufficientFundsFailure(
					new Error(
						'transaction cost exceeds transaction sender account balance',
					),
				),
			).toBe(true);
		});
	});

	it("finds it through viem's wrapping", () => {
		// viem reports a CATEGORY on the outside and keeps the node's wording
		// several layers down, which is why this walks the chain rather than
		// reading one message.
		const nested = {
			shortMessage: 'An unknown RPC error occurred.',
			cause: {
				shortMessage: 'Invalid parameters were provided to the RPC method.',
				cause: {
					details: "Sender doesn't have enough funds to send tx.",
				},
			},
		};
		expect(isInsufficientFundsFailure(nested)).toBe(true);
	});

	it('finds it through a real viem error chain', () => {
		const inner = new BaseError('An unknown RPC error occurred.', {
			details: 'insufficient funds for gas * price + value',
		});
		const outer = new ContractFunctionExecutionError(inner, {
			abi: doItAbi,
			functionName: 'doIt',
		});
		expect(isInsufficientFundsFailure(outer)).toBe(true);
	});

	it("uses viem's structured node error when there is one", () => {
		// Available only for the JSON-RPC codes viem classifies (geth's -32000),
		// never for hardhat's -32602. Preferred where it exists.
		expect(isInsufficientFundsFailure(new ViemInsufficientFundsError({}))).toBe(
			true,
		);
	});

	it("recognises viem's node error by TYPE, not by its wording", () => {
		// Stripped of its prose, because the prose is what viem is free to change
		// and the type is not. Without this the case above passes on the text
		// alone, and the structured check could be deleted unnoticed.
		const mute = new ViemInsufficientFundsError({});
		mute.message = 'RPC call failed.';
		mute.shortMessage = 'RPC call failed.';
		mute.details = '';
		expect(isInsufficientFundsFailure(mute)).toBe(true);
	});

	it('recognises the shortfall this app detected before sending', () => {
		expect(isInsufficientFundsFailure(new InsufficientFundsError(1n, 5n))).toBe(
			true,
		);
	});

	it('recognises that one by TYPE too', () => {
		// Same reason: `InsufficientFundsError`'s message happens to contain the
		// words the patterns look for, which would otherwise hide whether this is
		// answered structurally at all.
		const mute = new InsufficientFundsError(1n, 5n);
		mute.message = 'Cancelled.';
		expect(isInsufficientFundsFailure(mute)).toBe(true);
	});

	it('does not match an ordinary revert', () => {
		expect(
			isInsufficientFundsFailure(
				new Error('execution reverted: PreviousCommitmentNotRevealed'),
			),
		).toBe(false);
		expect(
			isInsufficientFundsFailure(
				new ContractFunctionRevertedError({
					abi: doItAbi,
					functionName: 'doIt',
					message: 'execution reverted',
				}),
			),
		).toBe(false);
	});

	it('does not match a contract that reverts saying "insufficient funds"', () => {
		// The expensive mistake: a revert reason is arbitrary text chosen by a
		// contract author, and topping up the account cannot fix it.
		expect(
			isInsufficientFundsFailure(
				new Error('execution reverted: ERC20: insufficient funds for transfer'),
			),
		).toBe(false);

		const reverted = new ExecutionRevertedError({
			message: 'insufficient funds for this purchase',
		});
		const wrapped = new ContractFunctionExecutionError(reverted, {
			abi: doItAbi,
			functionName: 'doIt',
		});
		expect(isInsufficientFundsFailure(wrapped)).toBe(false);
	});

	it('does not match a custom error whose arguments mention funds', () => {
		// The case that needs the error TYPE and not its text: viem renders a
		// custom error as `The contract function "doIt" reverted.` plus the decoded
		// arguments, so the word "reverted" never appears next to a reason and the
		// contract author's string is all that is left to read. Nothing about the
		// prose distinguishes this from a node refusing to pay.
		const abi = [
			...doItAbi,
			{
				type: 'error',
				name: 'PaymentFailed',
				inputs: [{type: 'string', name: 'reason'}],
			},
		] as const;
		const reverted = new ContractFunctionRevertedError({
			abi,
			functionName: 'doIt',
			data: encodeErrorResult({
				abi,
				errorName: 'PaymentFailed',
				args: ['insufficient funds for transfer'],
			}),
		});
		expect(reverted.message).toContain('insufficient funds for transfer');
		expect(isInsufficientFundsFailure(reverted)).toBe(false);
	});

	it('does not match a user rejecting the wallet prompt', () => {
		expect(
			isInsufficientFundsFailure(new Error('User rejected the request.')),
		).toBe(false);
		expect(
			isInsufficientFundsFailure(
				new UserRejectedRequestError(new Error('denied')),
			),
		).toBe(false);
	});

	it('survives junk rather than throwing while a failure is being reported', () => {
		// This runs on the error path. Throwing here would replace a message the
		// user could act on with a blank screen.
		for (const value of [
			undefined,
			null,
			'',
			0,
			42,
			{},
			{cause: {}},
			[],
			NaN,
		]) {
			expect(() => isInsufficientFundsFailure(value)).not.toThrow();
			expect(isInsufficientFundsFailure(value)).toBe(false);
		}
	});

	it('terminates on a cyclic cause chain', () => {
		const a: {cause?: unknown; message: string} = {message: 'nope'};
		a.cause = a;
		expect(isInsufficientFundsFailure(a)).toBe(false);
	});

	it('terminates on a cyclic chain that does contain the wording', () => {
		// The bound must not depend on the answer being "no".
		const a: {cause?: unknown; message: string} = {message: 'nope'};
		const b = {message: 'insufficient funds for gas * price + value', cause: a};
		a.cause = b;
		expect(isInsufficientFundsFailure(a)).toBe(true);
	});

	it('gives up rather than following an unbounded chain', () => {
		// A chain longer than the bound is not walked to the end; the wording is
		// out of reach and the honest answer is "not recognised".
		let deep: unknown = {details: 'insufficient funds for gas * price + value'};
		for (let i = 0; i < 40; i++) deep = {message: `layer ${i}`, cause: deep};
		expect(isInsufficientFundsFailure(deep)).toBe(false);
	});
});
