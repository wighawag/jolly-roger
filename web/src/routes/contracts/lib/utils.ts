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
function convertPrimitiveValue(value: string, solidityType: string): unknown {
	const trimmed = value.trim();

	// Handle address
	if (solidityType === 'address') {
		return trimmed as `0x${string}`;
	}

	// Handle unsigned integers
	if (solidityType.startsWith('uint')) {
		return BigInt(trimmed);
	}

	// Handle signed integers
	if (solidityType.startsWith('int')) {
		return BigInt(trimmed);
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
	return /^-?\d+$/.test(value);
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
	if (abiType.startsWith('uint') || abiType.startsWith('int')) {
		return 'number';
	}
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
				return 'Enter number...';
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
					return {valid: false, error: 'Invalid number format'};
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
