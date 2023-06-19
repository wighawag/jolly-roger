import {expect} from './utils/viem-chai';

import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {prefix_str} from 'jolly-roger-common';
import {Deployment, loadAndExecuteDeployments} from 'rocketh';

import {walletClient, contract, publicClient, getAccounts} from './viem';

import artifacts from '../generated/artifacts';
import {network} from 'hardhat';

async function deployGreetings(prefix: string) {
	const [deployer, ...otherAccounts] = await getAccounts();
	const hash = await walletClient.deployContract({
		...artifacts.GreetingsRegistry,
		account: deployer,
		args: [prefix],
	});

	const receipt = await publicClient.waitForTransactionReceipt({hash});

	if (!receipt.contractAddress) {
		throw new Error(`failed to deploy contract ${name}`);
	}

	return {
		registry: contract({address: receipt.contractAddress, abi: artifacts.GreetingsRegistry.abi}),
		prefix,
		otherAccounts,
	};
}

async function deployGreetingsWithHello() {
	return deployGreetings('hello');
}

describe('Registry', function () {
	describe('Deployment', function () {
		it('Should be already deployed', async function () {
			const deployments = await loadAndExecuteDeployments({
				provider: network.provider as any,
			});
			const registry = contract(deployments['Registry'] as Deployment<typeof artifacts.GreetingsRegistry.abi>);
			const prefix = await registry.read.prefix();
			expect(prefix).to.equal('');
		});

		it('Should set the right prefix', async function () {
			const {registry, prefix} = await loadFixture(deployGreetingsWithHello);
			expect(await registry.read.prefix()).to.equal(prefix);
		});

		it('specific prefix', async function () {
			const myPrefix = prefix_str('');
			const {registry} = await deployGreetings(myPrefix);
			expect(await registry.read.prefix()).to.equal(myPrefix);
		});

		it('Should be able to set message', async function () {
			const {registry, otherAccounts} = await loadFixture(deployGreetingsWithHello);
			const txHash = await registry.write.setMessage(['hello', 1], {
				account: otherAccounts[0],
			});
			expect(await publicClient.waitForTransactionReceipt({hash: txHash})).to.includeEvent(
				registry.abi,
				'MessageChanged'
			);
		});

		it('Should not be able to set message for other account', async function () {
			const {registry, otherAccounts} = await loadFixture(deployGreetingsWithHello);
			await expect(
				registry.write.setMessageFor([otherAccounts[1], 'hello', 1], {
					account: otherAccounts[0],
				})
			).to.be.revertedWith('NOT_AUTHORIZED');
		});
	});
});
