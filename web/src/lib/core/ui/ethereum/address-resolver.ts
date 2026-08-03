import {writable, type Readable} from 'svelte/store';
import type {ENSService} from '$lib/core/ens';
import {classifyAddressInput} from './address-input';

export type AddressResolverStatus =
	'empty' | 'typing' | 'resolving' | 'valid' | 'error';

export type AddressResolverState = {
	resolving: boolean;
	resolvedAddress: `0x${string}` | null;
	error: string | null;
	status: AddressResolverStatus;
};

export type AddressResolverStore = Readable<AddressResolverState> & {
	/** Feed the latest raw input; classifies, validates and (debounced) resolves. */
	update: (raw: string) => void;
};

function statusFor(
	resolving: boolean,
	error: string | null,
	resolvedAddress: `0x${string}` | null,
): AddressResolverStatus {
	if (resolving) return 'resolving';
	if (error) return 'error';
	if (resolvedAddress) return 'valid';
	return 'empty';
}

/**
 * Store for the address input: classifies raw input, validates hex addresses
 * immediately, and debounces ENS resolution. Owns all resolution state so the
 * input component only binds raw text and renders status.
 *
 * @param ensService optional ENS capability.
 * @param onResolved called whenever the resolved address changes (including to
 *   null) so the component can keep its bindable `value` in sync.
 * @param getDebounceMs getter for the ENS resolution debounce in ms.
 */
export function createAddressResolverStore(
	ensService: ENSService | undefined,
	onResolved: (address: `0x${string}` | null) => void,
	getDebounceMs: () => number,
): AddressResolverStore {
	const {subscribe, set} = writable<AddressResolverState>({
		resolving: false,
		resolvedAddress: null,
		error: null,
		status: 'empty',
	});

	let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

	function commit(
		resolving: boolean,
		resolvedAddress: `0x${string}` | null,
		error: string | null,
	) {
		set({
			resolving,
			resolvedAddress,
			error,
			status: statusFor(resolving, error, resolvedAddress),
		});
		onResolved(resolvedAddress);
	}

	function update(raw: string) {
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
			debounceTimeout = null;
		}

		const classification = classifyAddressInput(raw);

		switch (classification.kind) {
			case 'empty':
			case 'partial':
				commit(false, null, null);
				return;
			case 'address':
				commit(false, classification.address, null);
				return;
			case 'invalid':
				commit(false, null, 'Invalid address format');
				return;
			case 'ens': {
				if (!ensService) {
					commit(false, null, 'ENS resolution not available');
					return;
				}
				commit(true, null, null);
				const name = classification.name;
				debounceTimeout = setTimeout(async () => {
					try {
						const address = await ensService.resolveAddress(name);
						if (address) {
							commit(false, address, null);
						} else {
							commit(false, null, 'ENS name not found');
						}
					} catch (e) {
						commit(
							false,
							null,
							e instanceof Error ? e.message : 'Failed to resolve ENS name',
						);
					}
				}, getDebounceMs());
				return;
			}
		}
	}

	return {subscribe, update};
}
