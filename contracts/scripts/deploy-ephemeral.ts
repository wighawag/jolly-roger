/**
 * Deploy this repo's contracts to a chain that exists only for the length of
 * this process, and keep the records, so `scripts/ensure-deployments.mjs` can
 * export `web/src/lib/deployments.ts` without any real deployment.
 *
 * WHY. What `pnpm check` and the web unit tests need from that file is the ABIs
 * (from the compiler) and each contract's `linkedData` (assembled by the deploy
 * scripts from `rocketh/config.ts`). Neither needs a real chain, and addresses
 * only have to be plausible. Deploying for real, once, into a chain nobody
 * keeps gives exactly that, from the same scripts a real deploy runs, so it
 * cannot drift from them. A repo with no committed deployment records used to
 * have no way to type-check at all on a fresh clone, which made its verify
 * fail in every temporary worktree.
 *
 * THE `ephemeral` ENVIRONMENT, and its records are gitignored. The deploy data
 * in `rocketh/config.ts` is looked up by environment name and falls back to its
 * `default` entry, so no entry is needed for this one.
 *
 * INSTANT MINING AND AN AUTOMATIC GAS PRICE, forced here rather than taken from
 * a network in `hardhat.config.ts`, because the tree does not agree on one. The
 * `default` network mines instantly in jolly-roger, but template-commit-reveal
 * and the games below it give it one-second interval mining and
 * `gasPrice: 1n`, which is below the in-process chain's base fee: a deploy
 * there waits for a block that never takes its transaction. So this connects to
 * `default`, whatever each repo made of it, and overrides the two settings that
 * decide whether a deploy can finish.
 *
 * Run it with `pnpm --filter ./contracts exec hardhat run
 * scripts/deploy-ephemeral.ts`, which is what `ensure-deployments.mjs` does.
 */
import {network} from 'hardhat';
import {loadAndExecuteDeploymentsFromFiles} from '../rocketh/environment.js';

const connection = await network.connect({
	network: 'default',
	override: {mining: {auto: true, interval: 0}, gasPrice: 'auto'},
});

await loadAndExecuteDeploymentsFromFiles({
	provider: connection.provider,
	environment: 'ephemeral',
	saveDeployments: true,
});
