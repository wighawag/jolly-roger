import {describe, it, expect} from 'vitest';
import type {AbiParameter} from 'viem';
import {syncInputErrors} from '../../../src/routes/contracts/lib/input-errors';

const p = (type: string, name = '') => ({type, name}) as AbiParameter;

describe('syncInputErrors', () => {
	it('writes an error for an invalid value and deletes it once valid', () => {
		const inputs = [p('uint8', 'small')];
		const errors: Record<string, string> = {};

		syncInputErrors(inputs, {small: '300'}, errors);
		expect(errors.small).toBeTruthy();

		syncInputErrors(inputs, {small: '3'}, errors);
		expect(errors).toEqual({});
	});

	it('leaves an input with no value alone', () => {
		const errors: Record<string, string> = {other: 'kept'};
		syncInputErrors([p('uint256', 'amount')], {}, errors);
		expect(errors).toEqual({other: 'kept'});
	});

	it('keys an unnamed input by its index', () => {
		const errors: Record<string, string> = {};
		syncInputErrors([p('bool', '')], {arg0: 'maybe'}, errors);
		expect(Object.keys(errors)).toEqual(['arg0']);
	});

	it('validates an address like any other type when nothing is self-validated', () => {
		const errors: Record<string, string> = {};
		syncInputErrors([p('address', 'to')], {to: 'not an address'}, errors);
		expect(errors.to).toBeTruthy();
	});

	it('deletes, then skips, the error of a self-validated input', () => {
		const inputs = [p('address', 'to'), p('uint8', 'small')];
		const errors: Record<string, string> = {to: 'stale'};

		syncInputErrors(inputs, {to: 'not an address', small: '300'}, errors, {
			selfValidated: (input) => input.type === 'address',
		});

		expect(errors.to).toBeUndefined();
		expect(errors.small).toBeTruthy();
	});
});
