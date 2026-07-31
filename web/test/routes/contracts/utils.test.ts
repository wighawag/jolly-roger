import {describe, it, expect} from 'vitest';
import type {AbiParameter} from 'viem';
import {
	convertInputValues,
	formatFunctionSignature,
	formatOutputJSON,
	getContractFunctions,
	getFunctionSignature,
	getInputFieldType,
	getIntegerRange,
	getInputKey,
	getInputLabel,
	getInputPlaceholder,
	isValidAddress,
	isValidHex,
	isValidNumber,
	parseIntegerInput,
	isViewFunction,
	validateInputValue,
	type AbiFunction,
} from '../../../src/routes/contracts/lib/utils';

const p = (type: string, name = '', extra: Partial<AbiParameter> = {}) =>
	({type, name, ...extra}) as AbiParameter;

describe('getInputKey / getInputLabel', () => {
	it('uses the name when present', () => {
		expect(getInputKey(p('uint256', 'amount'), 0)).toBe('amount');
		expect(getInputLabel(p('uint256', 'amount'), 0)).toBe('amount');
	});
	it('falls back to an index-based key/label when unnamed', () => {
		expect(getInputKey(p('uint256', ''), 2)).toBe('arg2');
		expect(getInputLabel(p('uint256', ''), 2)).toBe('Argument 2');
	});
});

describe('getContractFunctions', () => {
	it('keeps only named function entries', () => {
		const abi = [
			{
				type: 'function',
				name: 'foo',
				inputs: [],
				outputs: [],
				stateMutability: 'view',
			},
			{type: 'event', name: 'Bar', inputs: []},
			{type: 'constructor', inputs: [], stateMutability: 'nonpayable'},
			{type: 'error', name: 'Boom', inputs: []},
		] as any;
		const fns = getContractFunctions(abi);
		expect(fns.map((f) => f.name)).toEqual(['foo']);
	});
});

describe('isViewFunction', () => {
	it('is true for view and pure', () => {
		expect(isViewFunction('view')).toBe(true);
		expect(isViewFunction('pure')).toBe(true);
	});
	it('is false for state-changing mutabilities', () => {
		expect(isViewFunction('nonpayable')).toBe(false);
		expect(isViewFunction('payable')).toBe(false);
	});
});

describe('formatFunctionSignature', () => {
	it('renders outputs, name and params', () => {
		const fn = {
			type: 'function',
			name: 'setMessage',
			inputs: [p('string', 'message')],
			outputs: [],
			stateMutability: 'nonpayable',
		} as unknown as AbiFunction;
		expect(formatFunctionSignature(fn)).toBe('setMessage(string message)');
	});

	it('prefixes the return type when there is an output', () => {
		const fn = {
			type: 'function',
			name: 'messages',
			inputs: [p('address', 'account')],
			outputs: [p('string', '')],
			stateMutability: 'view',
		} as unknown as AbiFunction;
		expect(formatFunctionSignature(fn)).toBe(
			'string messages(address account)',
		);
	});
});

describe('convertInputValues', () => {
	it('converts uint/int to bigint', () => {
		const inputs = [p('uint256', 'a'), p('int256', 'b')];
		expect(convertInputValues(inputs, {a: '42', b: '-7'})).toEqual([42n, -7n]);
	});

	it('converts bool from string', () => {
		const inputs = [p('bool', 'flag')];
		expect(convertInputValues(inputs, {flag: 'true'})).toEqual([true]);
		expect(convertInputValues(inputs, {flag: 'false'})).toEqual([false]);
	});

	it('passes address and string through', () => {
		const addr = '0x1234567890abcdef1234567890abcdef12345678';
		const inputs = [p('address', 'to'), p('string', 'msg')];
		expect(convertInputValues(inputs, {to: addr, msg: 'hi'})).toEqual([
			addr,
			'hi',
		]);
	});

	it('parses comma-separated dynamic arrays into typed items', () => {
		const inputs = [p('uint256[]', 'vals')];
		expect(convertInputValues(inputs, {vals: '1, 2, 3'})).toEqual([
			[1n, 2n, 3n],
		]);
	});

	it('parses fixed-size arrays', () => {
		const inputs = [p('address[2]', 'owners')];
		const a = '0x1111111111111111111111111111111111111111';
		const b = '0x2222222222222222222222222222222222222222';
		expect(convertInputValues(inputs, {owners: `${a}, ${b}`})).toEqual([
			[a, b],
		]);
	});

	it('drops empty items from array inputs', () => {
		const inputs = [p('uint256[]', 'vals')];
		expect(convertInputValues(inputs, {vals: '1, , 2'})).toEqual([[1n, 2n]]);
	});

	it('returns undefined for empty/missing values', () => {
		const inputs = [p('uint256', 'a')];
		expect(convertInputValues(inputs, {a: ''})).toEqual([undefined]);
		expect(convertInputValues(inputs, {})).toEqual([undefined]);
	});

	it('parses a tuple from JSON using its components', () => {
		const inputs = [
			p('tuple', 'point', {
				components: [p('uint256', 'x'), p('uint256', 'y')],
			}),
		];
		expect(convertInputValues(inputs, {point: '{"x": "3", "y": "4"}'})).toEqual(
			[{x: 3n, y: 4n}],
		);
	});

	it('parses a tuple array from JSON', () => {
		const inputs = [
			p('tuple[]', 'points', {
				components: [p('uint256', 'x'), p('uint256', 'y')],
			}),
		];
		expect(convertInputValues(inputs, {points: '[{"x":"1","y":"2"}]'})).toEqual(
			[[{x: 1n, y: 2n}]],
		);
	});

	it('throws a descriptive error on malformed tuple JSON', () => {
		const inputs = [p('tuple', 'point', {components: [p('uint256', 'x')]})];
		expect(() => convertInputValues(inputs, {point: '{bad'})).toThrow(
			/Invalid tuple format/,
		);
	});

	it('accepts a tuple already given as an object (not a JSON string)', () => {
		const inputs = [
			p('tuple', 'point', {
				components: [p('uint256', 'x'), p('uint256', 'y')],
			}),
		];
		expect(convertInputValues(inputs, {point: {x: '5', y: '6'}})).toEqual([
			{x: 5n, y: 6n},
		]);
	});

	it('accepts a tuple given positionally as an array', () => {
		const inputs = [
			p('tuple', 'point', {
				components: [p('uint256', 'x'), p('uint256', 'y')],
			}),
		];
		expect(convertInputValues(inputs, {point: '["7", "8"]'})).toEqual([
			[7n, 8n],
		]);
	});

	it('converts a nested tuple (tuple inside a tuple)', () => {
		const inputs = [
			p('tuple', 'line', {
				components: [
					p('tuple', 'start', {
						components: [p('uint256', 'x'), p('uint256', 'y')],
					}),
					p('address', 'owner'),
				],
			}),
		];
		const owner = '0x1111111111111111111111111111111111111111';
		expect(
			convertInputValues(inputs, {
				line: {start: {x: '1', y: '2'}, owner},
			}),
		).toEqual([{start: {x: 1n, y: 2n}, owner}]);
	});

	it('throws a descriptive error on malformed tuple[] JSON', () => {
		const inputs = [p('tuple[]', 'points', {components: [p('uint256', 'x')]})];
		expect(() => convertInputValues(inputs, {points: '[bad'})).toThrow(
			/Invalid tuple array format/,
		);
	});

	it('throws when tuple[] JSON is valid but not an array', () => {
		const inputs = [p('tuple[]', 'points', {components: [p('uint256', 'x')]})];
		expect(() => convertInputValues(inputs, {points: '{"x":"1"}'})).toThrow(
			/Expected array for tuple\[\] type/,
		);
	});

	it('accepts a dynamic array already given as a JS array', () => {
		const inputs = [p('uint256[]', 'vals')];
		expect(convertInputValues(inputs, {vals: ['1', '2']})).toEqual([[1n, 2n]]);
	});

	it('parses a bytes array, keeping each element as hex', () => {
		const inputs = [p('bytes32[]', 'hashes')];
		expect(convertInputValues(inputs, {hashes: '0xdead, 0xbeef'})).toEqual([
			['0xdead', '0xbeef'],
		]);
	});
});

describe('formatOutputJSON', () => {
	it('renders null for nullish output', () => {
		expect(formatOutputJSON(undefined)).toBe('null');
		expect(formatOutputJSON(null)).toBe('null');
	});
	it('stringifies bigints without throwing', () => {
		expect(formatOutputJSON({v: 5n})).toBe('{\n  "v": "5"\n}');
	});
});

describe('validators', () => {
	it('isValidAddress', () => {
		expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(
			true,
		);
		expect(isValidAddress('0x123')).toBe(false);
		expect(isValidAddress('notanaddress')).toBe(false);
	});
	it('isValidHex', () => {
		expect(isValidHex('0xabc123')).toBe(true);
		expect(isValidHex('0x')).toBe(true);
		expect(isValidHex('abc')).toBe(false);
	});
	it('isValidNumber', () => {
		expect(isValidNumber('123')).toBe(true);
		expect(isValidNumber('-123')).toBe(true);
		expect(isValidNumber('1.5')).toBe(false);
		expect(isValidNumber('abc')).toBe(false);
	});
});

describe('getInputFieldType', () => {
	it('maps solidity types to UI field types', () => {
		expect(getInputFieldType('bool')).toBe('select');
		// Integers are text, not number: see the 'integer inputs' block below.
		expect(getInputFieldType('uint256')).toBe('text');
		expect(getInputFieldType('int128')).toBe('text');
		expect(getInputFieldType('address')).toBe('text');
		expect(getInputFieldType('string')).toBe('text');
	});
});

describe('getInputPlaceholder', () => {
	it('gives type-appropriate placeholders', () => {
		expect(getInputPlaceholder('address')).toBe('0x...');
		expect(getInputPlaceholder('bool')).toBe('Select true/false');
		expect(getInputPlaceholder('uint256')).toBe('Enter number or 0x...');
		expect(getInputPlaceholder('bytes32')).toBe('0x...');
		expect(getInputPlaceholder('uint256[]')).toBe(
			'Enter comma-separated values...',
		);
	});
});

describe('validateInputValue', () => {
	it('accepts empty values as optional', () => {
		expect(validateInputValue('uint256', '')).toEqual({valid: true});
	});
	it('validates addresses', () => {
		expect(validateInputValue('address', '0x123').valid).toBe(false);
		expect(
			validateInputValue(
				'address',
				'0x1234567890abcdef1234567890abcdef12345678',
			).valid,
		).toBe(true);
	});
	it('validates bool', () => {
		expect(validateInputValue('bool', 'maybe').valid).toBe(false);
		expect(validateInputValue('bool', 'true').valid).toBe(true);
	});
	it('validates numbers and bytes', () => {
		expect(validateInputValue('uint256', '1.2').valid).toBe(false);
		expect(validateInputValue('uint256', '12').valid).toBe(true);
		expect(validateInputValue('bytes', 'nothex').valid).toBe(false);
		expect(validateInputValue('bytes', '0xabcd').valid).toBe(true);
	});
});

describe('getFunctionSignature', () => {
	it('produces the canonical selector signature', () => {
		expect(
			getFunctionSignature({
				type: 'function',
				name: 'transfer',
				stateMutability: 'nonpayable',
				inputs: [
					{name: 'to', type: 'address'},
					{name: 'amount', type: 'uint256'},
				],
				outputs: [],
			}),
		).toBe('transfer(address,uint256)');
	});

	it('distinguishes overloads that share a name', () => {
		// The ERC721 case that crashed the contracts page with
		// `each_key_duplicate`: same name, different arity.
		const base = {
			type: 'function',
			name: 'safeTransferFrom',
			stateMutability: 'nonpayable',
			outputs: [],
		} as const;
		const three = getFunctionSignature({
			...base,
			inputs: [
				{name: 'from', type: 'address'},
				{name: 'to', type: 'address'},
				{name: 'tokenId', type: 'uint256'},
			],
		});
		const four = getFunctionSignature({
			...base,
			inputs: [
				{name: 'from', type: 'address'},
				{name: 'to', type: 'address'},
				{name: 'tokenId', type: 'uint256'},
				{name: 'data', type: 'bytes'},
			],
		});
		expect(three).toBe('safeTransferFrom(address,address,uint256)');
		expect(four).toBe('safeTransferFrom(address,address,uint256,bytes)');
		expect(three).not.toBe(four);
	});

	it('expands tuples and keeps array suffixes', () => {
		expect(
			getFunctionSignature({
				type: 'function',
				name: 'submit',
				stateMutability: 'nonpayable',
				inputs: [
					{
						name: 'items',
						type: 'tuple[]',
						components: [
							{name: 'account', type: 'address'},
							{name: 'amount', type: 'uint256'},
						],
					},
				],
				outputs: [],
			}),
		).toBe('submit((address,uint256)[])');
	});

	it('yields unique keys across an abi that overloads a name', () => {
		// A trimmed ERC721. The two safeTransferFrom overloads are exactly what
		// crashed the contracts page, and they need no deployment to reproduce.
		const addr = {name: 'from', type: 'address'} as const;
		const to = {name: 'to', type: 'address'} as const;
		const id = {name: 'tokenId', type: 'uint256'} as const;
		const abi = [
			{
				type: 'function',
				name: 'ownerOf',
				stateMutability: 'view',
				inputs: [id],
				outputs: [{name: '', type: 'address'}],
			},
			{
				type: 'function',
				name: 'transferFrom',
				stateMutability: 'nonpayable',
				inputs: [addr, to, id],
				outputs: [],
			},
			{
				type: 'function',
				name: 'safeTransferFrom',
				stateMutability: 'nonpayable',
				inputs: [addr, to, id],
				outputs: [],
			},
			{
				type: 'function',
				name: 'safeTransferFrom',
				stateMutability: 'nonpayable',
				inputs: [addr, to, id, {name: 'data', type: 'bytes'}],
				outputs: [],
			},
		] as const;

		const fns = getContractFunctions(abi as never);
		const signatures = fns.map(getFunctionSignature);
		expect(new Set(signatures).size).toBe(signatures.length);
		// and the bare-name keying really was ambiguous
		const names = fns.map((f) => f.name);
		expect(new Set(names).size).toBeLessThan(names.length);
	});
});

describe('integer inputs', () => {
	const MAX_UINT256 = (1n << 256n) - 1n;

	it('never uses a number field for integers', () => {
		// Regression: `type="number"` is backed by a double, so it mangles
		// anything past 2^53 (most of the uint256 range, including ordinary wei
		// amounts) and refuses hex outright.
		for (const t of ['uint256', 'uint8', 'int256', 'int128', 'uint']) {
			expect(getInputFieldType(t)).toBe('text');
		}
		expect(getInputFieldType('bool')).toBe('select');
		expect(getInputFieldType('address')).toBe('text');
	});

	it('accepts decimal and hex, rejects junk', () => {
		expect(isValidNumber('0')).toBe(true);
		expect(
			isValidNumber(
				'115792089237316195423570985008687907853269984665640564039457584007913129639935',
			),
		).toBe(true);
		expect(isValidNumber('0xff')).toBe(true);
		expect(isValidNumber('0xDEADBEEF')).toBe(true);
		expect(isValidNumber('-42')).toBe(true);
		expect(isValidNumber('1.5')).toBe(false);
		expect(isValidNumber('1e18')).toBe(false);
		expect(isValidNumber('0x')).toBe(false);
		expect(isValidNumber('abc')).toBe(false);
	});

	it('parses full-range uint256 without precision loss', () => {
		// The whole point: a double would round this.
		expect(parseIntegerInput(MAX_UINT256.toString())).toBe(MAX_UINT256);
		expect(parseIntegerInput('0x' + MAX_UINT256.toString(16))).toBe(
			MAX_UINT256,
		);
		// a plain 1 ETH in wei, already past 2^53
		expect(parseIntegerInput('1000000000000000000')).toBe(10n ** 18n);
	});

	it('parses hex and decimal to the same value, including negatives', () => {
		expect(parseIntegerInput('255')).toBe(255n);
		expect(parseIntegerInput('0xff')).toBe(255n);
		// BigInt('-0x10') throws on its own, so the sign is handled explicitly
		expect(parseIntegerInput('-0x10')).toBe(-16n);
		expect(parseIntegerInput('-16')).toBe(-16n);
	});

	it('converts uint256 args through the full pipeline', () => {
		const param = {name: 'v', type: 'uint256'} as AbiParameter;
		const [converted] = convertInputValues([param], {
			v: MAX_UINT256.toString(),
		});
		expect(converted).toBe(MAX_UINT256);

		const [fromHex] = convertInputValues([param], {v: '0xff'});
		expect(fromHex).toBe(255n);
	});

	it('knows each integer type range', () => {
		expect(getIntegerRange('uint8')).toEqual({min: 0n, max: 255n});
		expect(getIntegerRange('uint256')).toEqual({min: 0n, max: MAX_UINT256});
		expect(getIntegerRange('uint')).toEqual({min: 0n, max: MAX_UINT256});
		expect(getIntegerRange('int8')).toEqual({min: -128n, max: 127n});
		expect(getIntegerRange('address')).toBeUndefined();
	});

	it('rejects values the encoder could not represent', () => {
		expect(validateInputValue('uint256', MAX_UINT256.toString()).valid).toBe(
			true,
		);
		expect(
			validateInputValue('uint256', (MAX_UINT256 + 1n).toString()).valid,
		).toBe(false);
		expect(validateInputValue('uint8', '255').valid).toBe(true);
		expect(validateInputValue('uint8', '256').valid).toBe(false);
		expect(validateInputValue('uint256', '-1').valid).toBe(false);
		expect(validateInputValue('int8', '-128').valid).toBe(true);
		expect(validateInputValue('int8', '-129').valid).toBe(false);
		// hex is validated on the same range
		expect(validateInputValue('uint8', '0xff').valid).toBe(true);
		expect(validateInputValue('uint8', '0x100').valid).toBe(false);
	});
});
