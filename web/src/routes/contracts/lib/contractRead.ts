/**
 * The contracts page's read: viem and the page's input conversion only, no wallet
 * and no app layer, so it copies into any app that has a `PublicClient`.
 */
import type {AbiFunction, PublicClient} from 'viem';
import {convertInputValues} from './utils';

/**
 * Read a view/pure function on an arbitrary contract.
 *
 * Converts the raw UI input map to typed args and performs the `readContract`
 * call. Throws on failure (the caller renders the message).
 */
export async function readContractValue(params: {
	publicClient: PublicClient;
	abiItem: AbiFunction;
	contractAddress: string;
	inputValues: Record<string, string>;
}): Promise<unknown> {
	const {publicClient, abiItem, contractAddress, inputValues} = params;

	if (!publicClient) {
		throw new Error('Public client not available');
	}

	const args = convertInputValues(abiItem.inputs, inputValues);

	return publicClient.readContract({
		address: contractAddress as `0x${string}`,
		abi: [abiItem],
		functionName: abiItem.name,
		// Dynamic args from user input - type cannot be inferred at compile time
		args: args as any,
	});
}
