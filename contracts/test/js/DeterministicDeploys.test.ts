import {expect} from 'earl';
import {describe, it} from 'node:test';
import {network} from 'hardhat';
import {loadAndExecuteDeploymentsFromFiles} from '../../rocketh/environment.js';
import {replayableTransactions} from '../../scripts/lan/replayable.js';

// The LAN package (nix/lan.nix) replays the deploy on a box's chain and
// refuses any transaction that is not a CREATE2 deployment through the
// factory (scripts/lan/replayable.ts). This runs the same check on every
// contract test run, so a deploy script without `deterministic: true` fails
// here, in the repo that wrote it, rather than in a Nix build.
describe('the deploy scripts', function () {
	it('deploy every contract deterministically, and send nothing else', async function () {
		// A chain of its own, from block 0, so every block read is the deploy's.
		const {provider} = await network.connect({
			network: 'default',
			override: {mining: {auto: true, interval: 0}, gasPrice: 'auto'},
		});
		const env = await loadAndExecuteDeploymentsFromFiles({provider});
		const transactions = await replayableTransactions(
			provider,
			[env.namedAccounts.deployer, env.namedAccounts.admin],
			env.deployments,
		);
		expect(transactions.length).toBeGreaterThan(0);
	});
});
