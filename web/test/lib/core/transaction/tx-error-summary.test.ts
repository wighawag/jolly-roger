import {describe, it, expect} from 'vitest';
import {
	BaseError,
	ContractFunctionExecutionError,
	InvalidParamsRpcError,
	RpcRequestError,
	TransactionExecutionError,
} from 'viem';
import {
	txErrorSummary,
	txErrorDetails,
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
	it('prefers the node reason when viem only knows the RPC category', () => {
		// Hardhat reports "not enough funds" under -32602, which viem renders as
		// "Invalid parameters were provided to the RPC method". Telling a user to
		// check their parameters when their account is empty sends them looking in
		// entirely the wrong place. Observed for real; this is that case.
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
		expect(summary).toContain("doesn't have enough funds");
		expect(summary.toLowerCase()).not.toContain('invalid parameters');
	});

	it('keeps viem the summary when viem models the error properly', () => {
		// A revert or a rejection is better described by viem than by the node's
		// raw text, so those must not be overridden.
		const error = new BaseError('boom', {details: 'raw node noise'});
		expect(txErrorSummary(error)).toBe('boom');
	});
});
