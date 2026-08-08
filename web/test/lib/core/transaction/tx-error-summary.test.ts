import {describe, it, expect} from 'vitest';
import {
	BaseError,
	ContractFunctionExecutionError,
	InternalRpcError,
	InvalidParamsRpcError,
	RpcRequestError,
	TransactionExecutionError,
} from 'viem';
import {
	txErrorSummary,
	txErrorDetails,
	INSUFFICIENT_FUNDS_SUMMARY,
} from '../../../../src/lib/core/transaction/tx-error-summary';

describe('txErrorSummary', () => {
	it("uses viem BaseError's shortMessage", () => {
		const error = new BaseError('full long message', {
			metaMessages: ['extra'],
		});
		// BaseError's shortMessage defaults to the first argument
		expect(txErrorSummary(error)).toBe('full long message');
	});

	it('walks nested viem errors to the deepest shortMessage', () => {
		const inner = new BaseError('sender balance too low');
		const outer = new ContractFunctionExecutionError(inner, {
			abi: [
				{
					type: 'function',
					name: 'doIt',
					inputs: [],
					outputs: [],
					stateMutability: 'nonpayable',
				},
			],
			functionName: 'doIt',
		});
		expect(txErrorSummary(outer)).toBe('sender balance too low');
	});

	it('takes the first line of a plain Error message', () => {
		const error = new Error('first line\nsecond line\nthird line');
		expect(txErrorSummary(error)).toBe('first line');
	});

	it('falls back for non-Error values', () => {
		expect(txErrorSummary('boom')).toBe('Transaction failed');
		expect(txErrorSummary(undefined)).toBe('Transaction failed');
	});

	it('names an account that cannot pay, instead of repeating the node', () => {
		expect(
			txErrorSummary(new Error('insufficient funds for gas * price + value')),
		).toBe(INSUFFICIENT_FUNDS_SUMMARY);
	});

	it("prefers that to viem's category for the same failure", () => {
		// The case that motivates asking the classifier FIRST: hardhat reports an
		// empty account under a generic JSON-RPC code, so viem's shortMessage sends
		// the user to check their parameters.
		const inner = new BaseError(
			'Invalid parameters were provided to the RPC method.',
			{
				details: "Sender doesn't have enough funds to send tx.",
			},
		);
		expect(txErrorSummary(inner)).toBe(INSUFFICIENT_FUNDS_SUMMARY);
	});

	it('leaves a revert to viem, even one that mentions funds', () => {
		expect(
			txErrorSummary(new Error('execution reverted: insufficient funds')),
		).toBe('execution reverted: insufficient funds');
	});
});

describe('txErrorDetails', () => {
	it('returns the full message for Errors', () => {
		const error = new Error('line1\nline2');
		expect(txErrorDetails(error)).toBe('line1\nline2');
	});

	it('stringifies non-Error values', () => {
		expect(txErrorDetails('boom')).toBe('boom');
	});
});

describe('txErrorSummary: generic RPC categories', () => {
	it("answers the real hardhat chain in the app's own words", () => {
		// Hardhat reports "not enough funds" under -32602, which viem renders as
		// "Invalid parameters were provided to the RPC method". Telling a user to
		// check their parameters when their account is empty sends them looking in
		// entirely the wrong place. Observed for real; this is that case, and it is
		// the end-to-end check that the classifier beats viem on the actual shape.
		//
		// This used to assert the node's own sentence, surfaced by `nodeDetails`.
		// Naming the problem is strictly better than repeating hardhat's phrasing
		// at the user, and it is now the same sentence however the shortfall was
		// found. What must not regress is the negative below.
		const rpc = new RpcRequestError({
			body: {},
			error: {
				code: -32602,
				message:
					"Sender doesn't have enough funds to send tx. The max upfront cost is: 1436988602448 and the sender's balance is: 0.",
			},
			url: 'http://localhost:8545',
		});
		const error = new TransactionExecutionError(
			new InvalidParamsRpcError(rpc),
			{
				account: null,
			},
		);

		const summary = txErrorSummary(error);
		expect(summary).toBe(INSUFFICIENT_FUNDS_SUMMARY);
		expect(summary.toLowerCase()).not.toContain('invalid parameters');
	});

	it('still prefers the node reason for categories that are not about funds', () => {
		// The funds case no longer reaches `nodeDetails`, so without a second
		// example the whole UNINFORMATIVE_SHORT_MESSAGE mechanism would be left
		// unpinned and look like dead code. This is the same shape from a different
		// cause: a specific, actionable problem reported under a generic code.
		const rpc = new RpcRequestError({
			body: {},
			error: {code: -32603, message: 'replacement transaction underpriced'},
			url: 'http://localhost:8545',
		});
		const error = new TransactionExecutionError(new InternalRpcError(rpc), {
			account: null,
		});

		const summary = txErrorSummary(error);
		expect(summary).toContain('replacement transaction underpriced');
		expect(summary.toLowerCase()).not.toContain('internal error');
	});

	it('keeps viem the summary when viem models the error properly', () => {
		// A revert or a rejection is better described by viem than by the node's
		// raw text, so those must not be overridden.
		const error = new BaseError('boom', {details: 'raw node noise'});
		expect(txErrorSummary(error)).toBe('boom');
	});
});
