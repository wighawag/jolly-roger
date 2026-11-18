/**
 * THIS REPO'S CONTRACTS, DEPLOYED INTO A CHAIN IN THIS NODE PROCESS: what a
 * unit test outside the contracts package (the web app's indexer tests,
 * `with/indexer`) needs to fold the very contracts the deploy scripts make.
 *
 * The chain is hardhat's in-process one (the `default` network, EDR), with no
 * port, and the deployment is the one `deploy/` runs, as
 * `scripts/deploy-ephemeral.ts` does for the type-check, so a test cannot drift
 * from a real deploy. Nothing is saved: the environment is `ephemeral` and the
 * records stay in memory.
 *
 * INSTANT MINING AND AN AUTOMATIC GAS PRICE are forced, for the reason
 * `scripts/deploy-ephemeral.ts` gives: the tree does not agree on what the
 * `default` network mines.
 *
 * THE WORKING DIRECTORY IS THE CONTRACTS PACKAGE while the deploy runs, and
 * only then: rocketh finds `deploy/` and its config from the working
 * directory, and a test runs from wherever its runner started (the web
 * package). A test process runs one file at a time, so nothing else reads the
 * working directory meanwhile.
 */
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHardhatRuntimeEnvironment} from 'hardhat/hre';
import config from '../hardhat.config.js';
import {loadAndExecuteDeploymentsFromFiles} from '../rocketh/environment.js';

/** The contracts package's root: this file runs from `utils/` or, built, from `dist/utils/`. */
function contractsRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	while (!existsSync(join(dir, 'hardhat.config.ts'))) {
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(`no hardhat.config.ts above ${import.meta.url}`);
		}
		dir = parent;
	}
	return dir;
}

export async function deployInProcess() {
	const root = contractsRoot();
	const hre = await createHardhatRuntimeEnvironment(config, {}, root);
	const connection = await hre.network.connect({
		network: 'default',
		override: {mining: {auto: true, interval: 0}, gasPrice: 'auto'},
	});
	const cwd = process.cwd();
	process.chdir(root);
	try {
		const env = await loadAndExecuteDeploymentsFromFiles({
			provider: connection.provider,
			environment: 'ephemeral',
			saveDeployments: false,
		});
		return {
			provider: connection.provider,
			env,
			close: () => connection.close(),
		};
	} finally {
		process.chdir(cwd);
	}
}
