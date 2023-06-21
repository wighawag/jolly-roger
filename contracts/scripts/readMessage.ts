import {Deployment, loadEnvironment} from 'rocketh';
import {context} from '../deploy/_context';
import {network} from 'hardhat';
import {EIP1193ProviderWithoutEvents} from 'eip-1193';
import {contract} from './viem';

async function main() {
	const env = await loadEnvironment(
		{
			provider: network.provider as EIP1193ProviderWithoutEvents,
			networkName: network.name,
		},
		context
	);

	const args = process.argv.slice(2);
	const account = (args[0] || process.env.ACCOUNT) as `0x${string}`;
	const Registry = env.deployments.Registry as Deployment<typeof context.artifacts.GreetingsRegistry.abi>;
	const RegistryContract = contract(Registry);
	const message = await RegistryContract.read.messages([account]);

	console.log({account, message});
}
main();
