import {Deployment, loadEnvironment} from 'rocketh';
import {context} from '../deploy/_context';
import {network} from 'hardhat';
import {EIP1193ProviderWithoutEvents} from 'eip-1193';
import {walletClient} from './viem';
import {encodeFunctionData} from 'viem';

async function main() {
	const env = await loadEnvironment(
		{
			provider: network.provider as EIP1193ProviderWithoutEvents,
			networkName: network.name,
		},
		context
	);

	const Registry = env.deployments.Registry;
	const [address] = await walletClient.getAddresses();
	const hash = await walletClient.writeContract({
		abi: Registry.abi,
		address: Registry.address,
		account: address,
		functionName: 'setMessage',
		args: ['hello ', 1],
	});

	console.log({hash});
}
main();
