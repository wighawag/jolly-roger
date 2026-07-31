import type {Abi, AbiFunction, AbiParameter, AbiStateMutability} from 'viem';
import {bigIntReplacer} from '$lib/core/utils/format';

export type {AbiFunction};

/**
 * Extended AbiParameter type that includes the optional components field for tuples.
 * Viem's AbiParameter type is a union that doesn't always expose components,
 * but we need to access it for tuple types.
 */
type AbiParameterWithComponents = AbiParameter & {
	components?: readonly AbiParameter[];
};

/**
 * Generate a unique key for an input parameter (by name or by index)
 */
export function getInputKey(input: AbiParameter, index: number): string {
	return input.name || `arg${index}`;
}

/**
 * Generate a display label for an input parameter
 */
export function getInputLabel(input: AbiParameter, index: number): string {
	return input.name || `Argument ${index}`;
}

/**
 * Extract only functions from ABI, filtering out events, errors, constructors, fallbacks, and receives
 */
export function getContractFunctions(abi: Abi): AbiFunction[] {
	return abi.filter((item): item is AbiFunction => {
		return item.type === 'function' && item.name !== undefined;
	});
}

/**
 * Determine if function is view/pure
 */
export function isViewFunction(stateMutability: AbiStateMutability): boolean {
	return stateMutability === 'view' || stateMutability === 'pure';
}

/**
 * Canonical Solidity selector signature, e.g. `safeTransferFrom(address,address,uint256)`.
 *
 * Unlike {@link formatFunctionSignature} this is for IDENTITY, not display: a
 * name alone is not unique because Solidity allows overloads (ERC721 ships two
 * `safeTransferFrom`s). Using the bare name as a keyed-each key crashes Svelte
 * with `each_key_duplicate`.
 */
export function getFunctionSignature(abiItem: AbiFunction): string {
	const params = abiItem.inputs.map((input) => canonicalType(input)).join(',');
	return `${abiItem.name}(${params})`;
}

/**
 * Canonical type name for selector purposes: tuples expand to their component
 * types, and array suffixes are preserved (`(address,uint256)[]`).
 */
function canonicalType(input: AbiParameter): string {
	const components = (input as {components?: readonly AbiParameter[]})
		.components;
	if (components && input.type.startsWith('tuple')) {
		const inner = components.map((c) => canonicalType(c)).join(',');
		// carry any array suffix, e.g. 'tuple[]' -> '(...)[]'
		return `(${inner})${input.type.slice('tuple'.length)}`;
	}
	return input.type;
}

/**
 * Format function signature for display
 */
export function formatFunctionSignature(abiItem: AbiFunction): string {
	const params = abiItem.inputs
		.map((input) => `${input.internalType || input.type} ${input.name}`)
		.join(', ');
	const outputs = abiItem.outputs
		.map((output) => `${output.internalType || output.type}`)
		.join(', ');

	return `${outputs ? `${outputs} ` : ''}${abiItem.name}(${params})`;
}

/**
 * Convert a single primitive value based on its Solidity type
 */
/**
 * Parse an integer field into a bigint, accepting decimal or 0x-hex, with an
 * optional leading minus on either form.
 *
 * BigInt() handles '0x..' and '-12' but throws on '-0x10', which the input
 * validation does accept, so the sign is split off first and reapplied.
 */
export function parseIntegerInput(value: string): bigint {
	const trimmed = value.trim();
	const negative = trimmed.startsWith('-');
	const magnitude = BigInt(negative ? trimmed.slice(1) : trimmed);
	return negative ? -magnitude : magnitude;
}

function convertPrimitiveValue(value: string, solidityType: string): unknown {
	const trimmed = value.trim();

	// Handle address
	if (solidityType === 'address') {
		return trimmed as `0x${string}`;
	}

	// Handle integers (signed and unsigned)
	if (solidityType.startsWith('uint') || solidityType.startsWith('int')) {
		return parseIntegerInput(trimmed);
	}

	// Handle bool
	if (solidityType === 'bool') {
		return trimmed === 'true';
	}

	// Handle string
	if (solidityType === 'string') {
		return trimmed;
	}

	// Handle bytes types
	if (solidityType.startsWith('bytes')) {
		return trimmed as `0x${string}`;
	}

	// Fallback
	return trimmed;
}

/**
 * Extract the base type from an array type (e.g., "uint256[]" -> "uint256", "address[3]" -> "address")
 */
function getArrayBaseType(arrayType: string): string | null {
	const match = arrayType.match(/^(\w+)\[\d*\]$/);
	return match ? match[1] : null;
}

/**
 * Parse a tuple value from JSON string or object
 * Returns the parsed object/array or throws an error with details
 */
function parseTupleValue(
	value: unknown,
	components: readonly AbiParameter[] | undefined,
): unknown {
	// If already an object/array, process it
	if (typeof value === 'object' && value !== null) {
		return convertTupleValue(value, components);
	}

	// Try to parse as JSON
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return convertTupleValue(parsed, components);
		} catch (e) {
			throw new Error(
				`Invalid tuple format. Expected JSON object/array. Error: ${e instanceof Error ? e.message : 'Parse error'}`,
			);
		}
	}

	return value;
}

/**
 * Recursively convert tuple values based on component types
 */
function convertTupleValue(
	value: unknown,
	components: readonly AbiParameter[] | undefined,
): unknown {
	if (!components || components.length === 0) {
		// No component info, return as-is
		return value;
	}

	// Handle array of tuples
	if (Array.isArray(value) && !components.some((c, i) => c.name === `${i}`)) {
		// If value is an array and components have names (not indexed), treat as positional
		return value.map((item, index) => {
			const component = components[index];
			if (!component) return item;
			return convertSingleValue(item, component);
		});
	}

	// Handle object (named properties)
	if (typeof value === 'object' && value !== null) {
		const result: Record<string, unknown> = {};
		for (const component of components) {
			const key = component.name || '';
			const componentValue = (value as Record<string, unknown>)[key];
			if (componentValue !== undefined) {
				result[key] = convertSingleValue(componentValue, component);
			}
		}
		return result;
	}

	return value;
}

/**
 * Convert a single value based on its ABI parameter type
 */
function convertSingleValue(value: unknown, param: AbiParameter): unknown {
	if (value === undefined || value === '' || value === null) {
		return undefined;
	}

	const type = param.type;
	// Cast to extended type to access components for tuple types
	const paramWithComponents = param as AbiParameterWithComponents;

	// Handle tuple
	if (type === 'tuple') {
		return parseTupleValue(value, paramWithComponents.components);
	}

	// Handle tuple array
	if (type === 'tuple[]') {
		if (typeof value === 'string') {
			try {
				value = JSON.parse(value);
			} catch (e) {
				throw new Error(
					`Invalid tuple array format. Expected JSON array. Error: ${e instanceof Error ? e.message : 'Parse error'}`,
				);
			}
		}
		if (!Array.isArray(value)) {
			throw new Error('Expected array for tuple[] type');
		}
		return value.map((item) =>
			parseTupleValue(item, paramWithComponents.components),
		);
	}

	// Handle dynamic arrays (e.g., uint256[])
	const baseType = getArrayBaseType(type);
	if (baseType && type.endsWith('[]')) {
		const items =
			typeof value === 'string'
				? value.split(',').map((v) => v.trim())
				: Array.isArray(value)
					? value
					: [value];

		return items
			.filter((v) => v !== '')
			.map((v) => convertPrimitiveValue(String(v), baseType));
	}

	// Handle fixed-size arrays (e.g., uint256[3])
	if (baseType && type.match(/\[\d+\]$/)) {
		const items =
			typeof value === 'string'
				? value.split(',').map((v) => v.trim())
				: Array.isArray(value)
					? value
					: [value];

		return items
			.filter((v) => v !== '')
			.map((v) => convertPrimitiveValue(String(v), baseType));
	}

	// Handle primitive types
	return convertPrimitiveValue(String(value), type);
}

/**
 * Convert input values from UI to contract format
 */
export function convertInputValues(
	inputs: readonly AbiParameter[],
	values: Record<string, any>,
): any[] {
	return inputs.map((input, index) => {
		const key = getInputKey(input, index);
		const value = values[key];
		return convertSingleValue(value, input);
	});
}

/**
 * Format output as pretty JSON
 */
export function formatOutputJSON(output: any): string {
	if (output === undefined || output === null) {
		return 'null';
	}
	try {
		return JSON.stringify(output, bigIntReplacer, 2);
	} catch {
		return String(output);
	}
}

/**
 * Validate address format
 */
export function isValidAddress(address: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate hex format
 */
export function isValidHex(hex: string): boolean {
	return /^0x[a-fA-F0-9]*$/.test(hex);
}

/**
 * Validate numeric input
 */
export function isValidNumber(value: string): boolean {
	return /^-?\d+$/.test(value) || /^-?0x[0-9a-fA-F]+$/.test(value);
}

/**
 * Bit width of a Solidity integer type; `uint`/`int` alone mean 256.
 * Returns undefined when the type is not an integer.
 */
export function getIntegerBits(abiType: string): number | undefined {
	const match = /^u?int(\d*)$/.exec(abiType);
	if (!match) return undefined;
	return match[1] ? parseInt(match[1], 10) : 256;
}

/**
 * Inclusive range a Solidity integer type can represent.
 */
export function getIntegerRange(
	abiType: string,
): {min: bigint; max: bigint} | undefined {
	const bits = getIntegerBits(abiType);
	if (bits === undefined) return undefined;
	if (abiType.startsWith('u')) {
		return {min: 0n, max: (1n << BigInt(bits)) - 1n};
	}
	const bound = 1n << BigInt(bits - 1);
	return {min: -bound, max: bound - 1n};
}

/**
 * Get input field type based on Solidity type
 */
export function getInputFieldType(
	abiType: string,
): 'text' | 'number' | 'select' {
	if (abiType === 'bool') {
		return 'select';
	}
	// Integers are TEXT, never `type="number"`. A number input is backed by a
	// double, so it silently mangles anything past 2^53 - which is most of the
	// uint256 range, including ordinary token amounts in wei - and it refuses
	// hex input outright. Values are parsed with BigInt (see
	// convertPrimitiveValue), which accepts both decimal and 0x forms exactly.
	return 'text';
}

/**
 * Get input placeholder based on Solidity type
 */
export function getInputPlaceholder(abiType: string): string {
	switch (abiType) {
		case 'address':
			return '0x...';
		case 'string':
			return 'Enter text...';
		case 'bool':
			return 'Select true/false';
		default:
			// Array check must come before the primitive checks below, otherwise
			// e.g. `uint256[]` would match the `uint` prefix and never reach here.
			if (abiType.includes('[]')) {
				return 'Enter comma-separated values...';
			}
			if (abiType.startsWith('uint') || abiType.startsWith('int')) {
				return 'Enter number or 0x...';
			}
			if (abiType.startsWith('bytes')) {
				return '0x...';
			}
			return 'Enter value...';
	}
}

/**
 * Validate input value based on Solidity type
 */
export function validateInputValue(
	abiType: string,
	value: string,
): {valid: boolean; error?: string} {
	if (!value) {
		return {valid: true}; // Empty is OK for optional params
	}

	switch (abiType) {
		case 'address':
			if (!isValidAddress(value)) {
				return {valid: false, error: 'Invalid address format (must be 0x...)'};
			}
			break;
		case 'bool':
			if (value !== 'true' && value !== 'false') {
				return {valid: false, error: 'Must be true or false'};
			}
			break;
		default:
			if (abiType.startsWith('uint') || abiType.startsWith('int')) {
				if (!isValidNumber(value)) {
					return {
						valid: false,
						error: 'Invalid number format (decimal or 0x hex)',
					};
				}
				// Catch out-of-range here rather than letting viem's encoder throw a
				// far less obvious error at send time.
				const range = getIntegerRange(abiType);
				if (range) {
					const parsed = parseIntegerInput(value);
					if (parsed < range.min) {
						return {
							valid: false,
							error: abiType.startsWith('u')
								? `${abiType} cannot be negative`
								: `Below the minimum for ${abiType}`,
						};
					}
					if (parsed > range.max) {
						return {valid: false, error: `Exceeds the maximum for ${abiType}`};
					}
				}
			}
			if (abiType.startsWith('bytes')) {
				if (!isValidHex(value)) {
					return {
						valid: false,
						error: 'Invalid hex format (must start with 0x...)',
					};
				}
			}
			break;
	}

	return {valid: true};
}
