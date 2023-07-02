import {
	Abi,
	CustomTransport,
	PublicClient,
	WalletClient,
	createPublicClient,
	createWalletClient,
	custom,
	getContract,
} from 'viem';

import hre from 'hardhat';
import type {EIP1193ProviderWithoutEvents} from 'eip-1193';

import {hardhat} from 'viem/chains';

export type Connection = {
	walletClient: WalletClient<CustomTransport, typeof hardhat>;
	publicClient: PublicClient<CustomTransport, typeof hardhat>;
	accounts: `0x${string}`[];
	provider: EIP1193ProviderWithoutEvents;
};

const cache: {connection?: Connection} = {};
export async function getConnection(): Promise<Connection> {
	if (cache.connection) {
		return cache.connection;
	}
	const provider = hre.network.provider as EIP1193ProviderWithoutEvents;

	const walletClient = createWalletClient({
		chain: hardhat,
		transport: custom(provider),
	});
	const publicClient = createPublicClient({
		chain: hardhat,
		transport: custom(provider),
	});
	return (cache.connection = {
		walletClient,
		publicClient,
		accounts: await walletClient.getAddresses(),
		provider,
	});
}

export async function fetchContract<TAbi extends Abi>(contractInfo: {address: `0x${string}`; abi: TAbi}) {
	const {walletClient, publicClient} = await getConnection();
	return getContract({
		...contractInfo,
		walletClient,
		publicClient,
	});
}
