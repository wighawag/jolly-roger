import {expect, describe, it} from 'vitest';
import './utils/viem-matchers';

import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {Deployment, loadAndExecuteDeployments} from 'rocketh';

import {getConnection, fetchContract} from '../utils/connection';

import artifacts from '../generated/artifacts';
import {network} from 'hardhat';

async function deployGreetings(prefix: string) {
	const {accounts, walletClient, publicClient} = await getConnection();
	const [deployer, ...otherAccounts] = accounts;

	const hash = await walletClient.deployContract({
		...artifacts.GreetingsRegistry,
		account: deployer,
		args: [prefix],
	} as any); // TODO https://github.com/wagmi-dev/viem/issues/648

	const receipt = await publicClient.waitForTransactionReceipt({hash});

	if (!receipt.contractAddress) {
		throw new Error(`failed to deploy contract`);
	}

	return {
		registry: await fetchContract({address: receipt.contractAddress, abi: artifacts.GreetingsRegistry.abi}),
		prefix,
		otherAccounts,
		walletClient,
		publicClient,
	};
}

async function deployGreetingsWithHello() {
	return deployGreetings('hello');
}

describe('Registry', function () {
	describe('Deployment', function () {
		it('Should be already deployed', async function () {
			const {deployments} = await loadAndExecuteDeployments({
				provider: network.provider as any,
			});
			const registry = await fetchContract(
				deployments['Registry'] as Deployment<typeof artifacts.GreetingsRegistry.abi>,
			);
			const prefix = await registry.read.prefix();
			expect(prefix).to.equal('');
		});

		it('Should set the right prefix', async function () {
			const {registry, prefix} = await loadFixture(deployGreetingsWithHello);
			expect(await registry.read.prefix()).to.equal(prefix);
		});

		it('specific prefix', async function () {
			const myPrefix = '';
			const {registry} = await deployGreetings(myPrefix);
			expect(await registry.read.prefix()).to.equal(myPrefix);
		});

		it('Should be able to set message', async function () {
			const {registry, otherAccounts, publicClient} = await loadFixture(deployGreetingsWithHello);
			const txHash = await registry.write.setMessage(['hello', 1], {
				account: otherAccounts[0],
			});
			expect(await publicClient.waitForTransactionReceipt({hash: txHash})).to.includeEvent(
				registry.abi,
				'MessageChanged',
			);
		});

		it('Should not be able to set message for other account', async function () {
			const {registry, otherAccounts} = await loadFixture(deployGreetingsWithHello);
			await expect(
				registry.write.setMessageFor([otherAccounts[1], 'hello', 1], {
					account: otherAccounts[0],
				}),
			).rejects.toThrow('NOT_AUTHORIZED');
		});
	});
});
