import type {ConnectedState, ConnectedNetworkState, GenericContractsInfos} from 'web3-connection';
import type {Chain, Hash, WalletClient} from 'viem';
import type {WriteContractParameters} from 'viem/contract';
import type {NetworkConfig} from '$lib/config';
import type {Abi} from 'abitype';
import {createWalletClient, custom} from 'viem';
import {execute} from '$lib/web3';

type ContractParameters<TAbi extends Abi, TFunctionName extends string = string, TChain extends Chain = Chain> = Omit<
	WriteContractParameters<TAbi, TFunctionName, TChain>,
	'address' | 'abi' | 'account'
>;

export type ViemContract<ABI extends Abi, TChain extends Chain = Chain> = {
	write: <TFunctionName extends string = string>(
		params: ContractParameters<ABI, TFunctionName, TChain>
	) => Promise<Hash>;
};

export type Contracts = NetworkConfig['contracts'];
export type ViemContracts = {
	[ContractName in keyof Contracts]: ViemContract<Contracts[ContractName]['abi']>;
};

export const contracts = {
	execute<T>(
		callback: (state: {
			connection: ConnectedState;
			network: ConnectedNetworkState<NetworkConfig>;
			contracts: ViemContracts;
			client: WalletClient;
		}) => Promise<T>
	) {
		return execute(async ({connection, network, account}) => {
			const client = createWalletClient({
				transport: custom(connection.provider),
			});
			const anyContracts = network.contracts as GenericContractsInfos;
			const contracts: ViemContracts = Object.keys(network.contracts).reduce((prev, curr) => {
				const contract = anyContracts[curr];
				const write = (args: ContractParameters<Abi>) => {
					return client.writeContract({
						chain: {
							id: parseInt(network.chainId),
						} as Chain, // TODO
						account: account.address,
						address: contract.address,
						abi: contract.abi,
						functionName: args.functionName,
						args: args.args as any,
					});
				};
				const viemContract: ViemContract<Abi> = {
					write,
				} as ViemContract<Abi>;
				(prev as any)[curr] = viemContract;
				return prev;
			}, {} as ViemContracts);
			return callback({
				connection,
				network,
				client,
				contracts,
			});
		});
	},
};
