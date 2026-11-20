import {writable} from 'svelte/store';
import type {AbiFunction, PublicClient} from 'viem';
import {getContractFunctions} from '../../../contracts/lib/utils';
import {findContractByAddress, isContract, type ContractInfo} from '../utils';
import {deployments} from '$lib/deployments-store';

export interface AddressDataState {
	balance: bigint;
	nonce: number;
	code: `0x${string}`;
	contractInfo: ContractInfo | null;
	contractFunctions: AbiFunction[];
	loading: boolean;
	error: string | null;
}

const initialState: AddressDataState = {
	balance: 0n,
	nonce: 0,
	code: '0x',
	contractInfo: null,
	contractFunctions: [],
	loading: false,
	error: null,
};

/**
 * Store owning the on-chain data for a single address: balance, nonce, code,
 * and (when the code matches a deployment) the contract's callable functions.
 *
 * Mirrors the transactionList store pattern so the AddressView component only
 * subscribes and renders.
 */
export function createAddressDataStore(params: {publicClient: PublicClient}) {
	const {publicClient} = params;
	const {subscribe, set, update} = writable<AddressDataState>(initialState);

	async function fetch(address: `0x${string}` | null): Promise<void> {
		if (!address) {
			set({...initialState});
			return;
		}
		if (!publicClient) {
			set({...initialState, error: 'Public client not available'});
			return;
		}

		update((state) => ({...state, loading: true, error: null}));

		try {
			const [balance, nonce, rawCode] = await Promise.all([
				publicClient.getBalance({address}),
				publicClient.getTransactionCount({address}),
				publicClient.getCode({address}),
			]);
			const code = rawCode ?? '0x';

			let contractInfo: ContractInfo | null = null;
			let contractFunctions: AbiFunction[] = [];
			if (isContract(code)) {
				contractInfo = findContractByAddress(
					address,
					deployments.get().contracts,
				);
				if (contractInfo) {
					contractFunctions = getContractFunctions(contractInfo.abi);
				}
			}

			set({
				balance,
				nonce,
				code,
				contractInfo,
				contractFunctions,
				loading: false,
				error: null,
			});
		} catch (e: unknown) {
			const error = e as Error;
			console.error('Error fetching address:', e);
			update((state) => ({
				...state,
				error: error.message || 'Failed to fetch address data',
				loading: false,
			}));
		}
	}

	return {subscribe, fetch};
}

const storeInstances = new WeakMap<
	PublicClient,
	ReturnType<typeof createAddressDataStore>
>();

export function getAddressDataStore(params: {publicClient: PublicClient}) {
	let store = storeInstances.get(params.publicClient);
	if (!store) {
		store = createAddressDataStore(params);
		storeInstances.set(params.publicClient, store);
	}
	return store;
}
