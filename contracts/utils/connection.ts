import {
	Abi,
	CustomTransport,
	PublicClient,
	WalletClient,
	createPublicClient,
	createWalletClient,
	custom,
	defineChain,
	getContract,
} from 'viem';

import hre from 'hardhat';
import type {EIP1193ProviderWithoutEvents} from 'eip-1193';
import {Chain} from 'viem';

export type Connection = {
	walletClient: WalletClient<CustomTransport, Chain>;
	publicClient: PublicClient<CustomTransport, Chain>;
	accounts: `0x${string}`[];
	provider: EIP1193ProviderWithoutEvents;
};

const cache: {connection?: Connection} = {};
export async function getConnection(): Promise<Connection> {
	if (cache.connection) {
		return cache.connection;
	}
	const provider = hre.network.provider as EIP1193ProviderWithoutEvents;

	const chainIdAsHex = await provider.request({method: 'eth_chainId'});
	const chainIdAsNumber = parseInt(chainIdAsHex.slice(2), 16);
	const chain = defineChain({
		id: chainIdAsNumber,
		name: hre.network.name,
		network: hre.network.name,
		nativeCurrency: {
			decimals: 18,
			name: 'Ether',
			symbol: 'ETH',
		},
		rpcUrls: {
			default: {http: []},
			public: {http: []},
		},
	} as const);

	const walletClient = createWalletClient({
		chain,
		transport: custom(provider),
	});
	const publicClient = createPublicClient({
		chain,
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

export type ContractWithViemClient<TAbi extends Abi> = Awaited<ReturnType<typeof fetchContract<TAbi>>>;
