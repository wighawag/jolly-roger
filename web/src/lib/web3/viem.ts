import type {
	ConnectedState,
	ConnectedNetworkState,
	GenericContractsInfos,
	SingleNetworkConfig,
	ConnectedAccountState,
} from 'web3-connection';
import {
	createPublicClient,
	type WalletClient,
	type PublicClient,
	type GetContractReturnType,
	type CustomTransport,
	type Address,
	type LocalAccount,
	type Chain,
} from 'viem';
import {createWalletClient, custom, getContract} from 'viem';
import {execute} from '$lib/web3';
import {initialContractsInfos, type NetworkConfig} from '$lib/config';

export type ViemContracts<ContractsTypes extends GenericContractsInfos, TAddress extends Address> = {
	[ContractName in keyof ContractsTypes]: GetContractReturnType<
		ContractsTypes[ContractName]['abi'],
		PublicClient<CustomTransport>,
		WalletClient<CustomTransport, Chain, LocalAccount<TAddress>>,
		TAddress
	>;
};

// TODO we dont really need initialContractsInfos
function initViemContracts<ContractsInfos extends GenericContractsInfos>(
	initialContractsInfos: SingleNetworkConfig<ContractsInfos>
) {
	return {
		execute<T, TAddress extends Address>(
			callback: (state: {
				connection: ConnectedState;
				account: ConnectedAccountState<TAddress>;
				network: ConnectedNetworkState<ContractsInfos>;
				contracts: ViemContracts<ContractsInfos, TAddress>;
				walletClient: WalletClient;
				publicClient: PublicClient;
			}) => Promise<T>
		) {
			return execute(async ({connection, network, account}) => {
				const transport = custom(connection.provider);
				const publicClient = createPublicClient({transport});
				const walletClient = createWalletClient({
					transport,
					account: account.address,
				});
				const anyContracts = network.contracts as GenericContractsInfos;
				const contracts: ViemContracts<ContractsInfos, TAddress> = Object.keys(network.contracts).reduce(
					(prev, curr) => {
						const contract = anyContracts[curr];
						const viemContract = getContract({...contract, walletClient, publicClient});

						(prev as any)[curr] = viemContract;
						return prev;
					},
					{} as ViemContracts<ContractsInfos, TAddress>
				);
				return callback({
					connection,
					account: account as ConnectedAccountState<TAddress>,
					network,
					publicClient,
					walletClient,
					contracts,
				});
			});
		},
	};
}

export const contracts = initViemContracts(initialContractsInfos);
