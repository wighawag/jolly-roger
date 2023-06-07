import {Abi, createPublicClient, createWalletClient, custom, getContract} from 'viem';

import {network} from 'hardhat';

import {hardhat} from 'viem/chains';

export const walletClient = createWalletClient({
	chain: hardhat,
	transport: custom(network.provider),
});

export const publicClient = createPublicClient({
	chain: hardhat,
	transport: custom(network.provider),
});

export function getAccounts() {
	return walletClient.getAddresses();
}

export function contract<TAbi extends Abi>(contractInfo: {address: `0x${string}`; abi: TAbi}) {
	return getContract({
		...contractInfo,
		walletClient,
		publicClient,
	});
}
