import {Deployment, loadEnvironment} from 'rocketh';
import {context} from '../deploy/_context';
import hre from 'hardhat';
import {EIP1193ProviderWithoutEvents} from 'eip-1193';
import {fetchContract} from '../utils/connection';

async function main() {
	const env = await loadEnvironment(
		{
			provider: hre.network.provider as EIP1193ProviderWithoutEvents,
			networkName: hre.network.name,
		},
		context,
	);

	const args = process.argv.slice(2);
	const account = (args[0] || process.env.ACCOUNT) as `0x${string}`;
	const Registry = env.deployments.Registry as Deployment<typeof context.artifacts.GreetingsRegistry.abi>;
	const RegistryContract = await fetchContract(Registry);
	const message = await RegistryContract.read.messages([account]);

	console.log({account, message});
}
main();
