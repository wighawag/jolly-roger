import {Deployment, loadEnvironment} from 'rocketh';
import {context} from '../deploy/_context';
import {network} from 'hardhat';
import {EIP1193ProviderWithoutEvents} from 'eip-1193';
import {contract, walletClient} from './viem';

async function main() {
	const env = await loadEnvironment(
		{
			provider: network.provider as EIP1193ProviderWithoutEvents,
			networkName: network.name,
		},
		context
	);

	const args = process.argv.slice(2);
	const message = (args[0] || process.env.MESSAGE) as `0x${string}`;

	const [address] = await walletClient.getAddresses();
	const Registry = env.deployments.Registry as Deployment<typeof context.artifacts.GreetingsRegistry.abi>;
	const RegistryContract = contract(Registry);
	const hash = await RegistryContract.write.setMessage([message, 1], {account: address});

	console.log({hash, account: address});
}
main();
