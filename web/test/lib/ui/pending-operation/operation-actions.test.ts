import {describe, it, expect} from 'vitest';
import {
	deriveMinGasPrice,
	deriveCancelGasPrice,
	toReplacementErrorMessage,
} from '../../../../src/lib/ui/pending-operation/operation-actions';
import {InsufficientFundsError} from '../../../../src/lib/core/transaction';
import type {OnchainOperation} from '../../../../src/lib/account/AccountData';

function operationWithGasParameters(
	...gasParameters: unknown[]
): OnchainOperation {
	return {
		attempts: gasParameters.map((params) => ({gasParameters: params})),
	} as unknown as OnchainOperation;
}

describe('deriveMinGasPrice', () => {
	it('returns undefined for a null operation', () => {
		expect(deriveMinGasPrice(null)).toBeUndefined();
	});

	it('reads EIP-1559 fields', () => {
		const op = operationWithGasParameters({
			maxFeePerGas: 100n,
			maxPriorityFeePerGas: 10n,
		});
		expect(deriveMinGasPrice(op)).toEqual({
			maxFeePerGas: 100n,
			maxPriorityFeePerGas: 10n,
		});
	});

	it('falls back to legacy gasPrice for both fields', () => {
		const op = operationWithGasParameters({gasPrice: 50n});
		expect(deriveMinGasPrice(op)).toEqual({
			maxFeePerGas: 50n,
			maxPriorityFeePerGas: 50n,
		});
	});

	it('returns undefined when no fee info is present', () => {
		expect(deriveMinGasPrice(operationWithGasParameters({}))).toBeUndefined();
		expect(deriveMinGasPrice(operationWithGasParameters())).toBeUndefined();
	});

	/**
	 * THE FLOOR IS THE MAXIMUM ACROSS ATTEMPTS, NOT THE LAST ONE.
	 *
	 * A replacement only replaces if it outbids every transaction already at that
	 * nonce, so the constraint is the largest fee any attempt paid. "The last
	 * one" would agree here most of the time and only most: nothing in the type
	 * guarantees the array is in dispatch order, and a floor taken from a cheaper
	 * attempt is accepted by the form and then rejected by the node as an
	 * underpriced replacement. Hence the deliberately UNSORTED fixtures below.
	 */
	it('takes the highest fee across attempts, whatever their order', () => {
		expect(
			deriveMinGasPrice(
				operationWithGasParameters(
					{maxFeePerGas: 100n, maxPriorityFeePerGas: 10n},
					{maxFeePerGas: 300n, maxPriorityFeePerGas: 30n},
					{maxFeePerGas: 200n, maxPriorityFeePerGas: 20n},
				),
			),
		).toEqual({maxFeePerGas: 300n, maxPriorityFeePerGas: 30n});

		// The largest is FIRST, so "the last one" would under-report it.
		expect(
			deriveMinGasPrice(
				operationWithGasParameters(
					{maxFeePerGas: 500n, maxPriorityFeePerGas: 50n},
					{maxFeePerGas: 200n, maxPriorityFeePerGas: 20n},
				),
			),
		).toEqual({maxFeePerGas: 500n, maxPriorityFeePerGas: 50n});
	});

	it('maximises the two fields independently, across mixed attempt types', () => {
		// A legacy attempt states one price that serves as both, so the highest
		// cap and the highest tip can come from different attempts.
		expect(
			deriveMinGasPrice(
				operationWithGasParameters(
					{maxFeePerGas: 400n, maxPriorityFeePerGas: 5n},
					{gasPrice: 90n},
				),
			),
		).toEqual({maxFeePerGas: 400n, maxPriorityFeePerGas: 90n});
	});

	it('ignores an attempt that states no fee at all', () => {
		// A resubmit migrated from a v1 record carries no gas parameters. It must
		// not drag the floor down to undefined for the attempts that do have one.
		expect(
			deriveMinGasPrice(
				operationWithGasParameters(
					{},
					{maxFeePerGas: 100n, maxPriorityFeePerGas: 10n},
				),
			),
		).toEqual({maxFeePerGas: 100n, maxPriorityFeePerGas: 10n});
	});
});

describe('deriveCancelGasPrice', () => {
	it('uses fast price when it exceeds the original', () => {
		expect(deriveCancelGasPrice({maxFeePerGas: 10n}, 100n)).toBe(100n);
	});

	it('bumps the original by 1 wei when it is at least the fast price', () => {
		expect(deriveCancelGasPrice({maxFeePerGas: 200n}, 100n)).toBe(201n);
	});

	it('handles missing gas parameters (treats original as 0)', () => {
		expect(deriveCancelGasPrice(undefined, 100n)).toBe(100n);
		expect(deriveCancelGasPrice(undefined, 0n)).toBe(1n);
	});

	it('falls back to legacy gasPrice', () => {
		expect(deriveCancelGasPrice({gasPrice: 300n}, 100n)).toBe(301n);
	});
});

describe('toReplacementErrorMessage', () => {
	it('returns null for an insufficient-funds dismissal', () => {
		expect(
			toReplacementErrorMessage(new InsufficientFundsError(0n, 1n), 'fallback'),
		).toBeNull();
	});

	it('maps user-rejection code 4001', () => {
		expect(toReplacementErrorMessage({code: 4001}, 'fallback')).toBe(
			'Transaction rejected by user',
		);
	});

	it('maps nonce conflicts from the message', () => {
		expect(
			toReplacementErrorMessage({message: 'nonce too low'}, 'fallback'),
		).toBe('Nonce conflict - transaction may have already been processed');
	});

	it('uses the error message, then the fallback', () => {
		expect(toReplacementErrorMessage({message: 'boom'}, 'fallback')).toBe(
			'boom',
		);
		expect(toReplacementErrorMessage({}, 'fallback')).toBe('fallback');
	});
});
