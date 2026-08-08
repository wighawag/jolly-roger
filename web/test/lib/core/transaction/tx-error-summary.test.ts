import {describe, it, expect} from 'vitest';
import {BaseError, ContractFunctionExecutionError} from 'viem';
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
