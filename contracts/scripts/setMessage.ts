import {Deployment, loadEnvironment} from 'rocketh';
import {context} from '../deploy/_context';
import hre from 'hardhat';
import {EIP1193ProviderWithoutEvents} from 'eip-1193';
import {fetchContract, getConnection} from '../utils/connection';

async function main() {
	const env = await loadEnvironment(
		{
			provider: hre.network.provider as EIP1193ProviderWithoutEvents,
			networkName: hre.network.name,
		},
		context,
	);

	const {walletClient} = await getConnection();

	const args = process.argv.slice(2);
	const message = (args[0] || process.env.MESSAGE) as `0x${string}`;

	const [address] = await walletClient.getAddresses();
	const Registry = env.deployments.Registry as Deployment<typeof context.artifacts.GreetingsRegistry.abi>;
	const RegistryContract = await fetchContract(Registry);
	const hash = await RegistryContract.write.setMessage([message, 1], {account: address});

	console.log({hash, account: address});
}
main();
