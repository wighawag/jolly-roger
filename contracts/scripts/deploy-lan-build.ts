/**
 * Deploy this repo's contracts for a LAN box (github:wighawag/ethereum-lan-node)
 * WITHOUT the box: into a chain that exists only for this process, with the
 * box's chain id, so that the web app can be built with the addresses the box
 * will have. Run by nix/lan.nix at build time, where there is no network.
 *
 * It writes the `lan` deployment records (exported to the web app) and
 * `LAN_TRANSACTIONS` (default deployments/lan.transactions.json): every
 * transaction the deploy sent, which the box's deploy step replays
 * (nix/lan-deploy.sh) against its real chain. That file sits BESIDE the
 * records, not among them, because rocketh reads every file in
 * deployments/lan/ as a deployment.
 *
 * WHY THE ADDRESSES ARE THE BOX'S. Every contract is deployed through the
 * deterministic-deployment proxy at 0x4e59b448..., which the box's genesis
 * predeploys and which rocketh deploys here with the same pre-signed
 * transaction, so an address depends only on the salt and the init code: not
 * on the chain, its history, or a nonce. A setup call is kept only if its
 * `execute` has a guard, which the box reads before replaying it
 * (scripts/lan/record.ts); anything else is refused (scripts/lan/replayable.ts
 * says why). Every sender is one of the first 20 accounts of the test
 * mnemonic, on the box as here.
 *
 * INSTANT MINING AND AN AUTOMATIC GAS PRICE are forced, as in
 * scripts/deploy-ephemeral.ts, since the `default` network differs across the
 * template tree.
 *
 * Run by hand with `LAN_CHAIN_ID=19216801 pnpm exec hardhat run
 * --build-profile production scripts/deploy-lan-build.ts`. It leaves
 * deployments/lan/ behind (gitignored, and skipped by
 * scripts/ensure-deployments.mjs).
 */
import {network} from 'hardhat';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {FACTORY, replayableTransactions} from './lan/replayable.js';
import {recordingEnvironment, type Recorded} from './lan/record.js';
import {MNEMONIC_ACCOUNTS} from './lan/accounts.js';

/** The box's chain id (ethereum-lan-node nix/genesis.json). */
const CHAIN_ID = Number(process.env.LAN_CHAIN_ID ?? 19216801);
const out = resolve(
	process.env.LAN_TRANSACTIONS ?? 'deployments/lan.transactions.json',
);

const connection = await network.connect({
	network: 'default',
	override: {
		chainId: CHAIN_ID,
		mining: {auto: true, interval: 0},
		gasPrice: 'auto',
	},
});
const provider = connection.provider;

const recorded: Recorded = new Map();
const env = await recordingEnvironment(recorded)({
	provider,
	environment: 'lan',
	saveDeployments: true,
});

let transactions;
try {
	transactions = await replayableTransactions(
		provider,
		MNEMONIC_ACCOUNTS,
		env.deployments,
		recorded,
	);
} catch (error) {
	throw new Error(`deploy-lan-build: ${(error as Error).message}`);
}
mkdirSync(dirname(out), {recursive: true});
writeFileSync(
	out,
	JSON.stringify(
		{chainId: CHAIN_ID, factory: FACTORY, transactions},
		null,
		'\t',
	) + '\n',
);
console.log(
	`deploy-lan-build: ${transactions.length} transactions for chain ${CHAIN_ID} in ${out}`,
);
for (const [name, d] of Object.entries(env.deployments))
	console.log(`  ${name} ${d.address}`);
