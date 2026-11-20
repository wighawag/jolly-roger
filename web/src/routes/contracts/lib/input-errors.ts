import type {AbiParameter} from 'viem';
import {getInputKey, validateInputValue} from './utils';

export type SyncInputErrorsOptions = {
	/**
	 * An input this returns true for validates itself (jolly-roger's
	 * `AddressInput.svelte` does, for an address): its error is deleted and it is
	 * not validated here. Without it every input is validated by its type,
	 * addresses included.
	 */
	selfValidated?: (input: AbiParameter) => boolean;
};

/**
 * Write each input's validation error into `errors` (a component's `$state`
 * object), or delete it once the value is valid. An input with no value yet is
 * left as it is.
 *
 * The validation loop of the contracts page's inputs, kept out of the component
 * so the page stays logic-minimal and the loop can be copied on its own.
 */
export function syncInputErrors(
	inputs: readonly AbiParameter[],
	values: Record<string, unknown>,
	errors: Record<string, string>,
	options?: SyncInputErrorsOptions,
): void {
	for (const [index, input] of inputs.entries()) {
		const key = getInputKey(input, index);
		if (options?.selfValidated?.(input)) {
			delete errors[key];
			continue;
		}
		if (values[key] !== undefined) {
			const validation = validateInputValue(input.type, String(values[key]));
			if (!validation.valid && validation.error) {
				errors[key] = validation.error;
			} else {
				delete errors[key];
			}
		}
	}
}
