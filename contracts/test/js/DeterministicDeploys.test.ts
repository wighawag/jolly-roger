import {expect} from 'earl';
import {describe, it} from 'node:test';
import {network} from 'hardhat';
import {replayableTransactions} from '../../scripts/lan/replayable.js';
import {recordingEnvironment, type Recorded} from '../../scripts/lan/record.js';
import {MNEMONIC_ACCOUNTS} from '../../scripts/lan/accounts.js';

// The LAN package (nix/lan.nix) replays the deploy on a box's chain: CREATE2
// deployments through the factory, and setup calls only when guarded
// (scripts/lan/replayable.ts). This runs the same check on every contract test
// run, so a deploy script without `deterministic: true`, or with an unguarded
// `execute`, fails here, in the repo that wrote it, rather than in a Nix build.

/** The deploy exactly as the LAN build runs it, on a chain of its own. */
async function lanDeploy() {
	// From block 0, so every block read is this deploy's; the `lan`
	// environment on the box's chain id, so a deploy script that does something
	// else there is checked doing that; no records on disk (deployments/lan is
	// the LAN build's).
	const {provider} = await network.connect({
		network: 'default',
		override: {
			chainId: 19216801,
			mining: {auto: true, interval: 0},
			gasPrice: 'auto',
		},
	});
	const recorded: Recorded = new Map();
	const env = await recordingEnvironment(recorded)({
		provider,
		environment: 'lan',
		saveDeployments: false,
	});
	return {provider, env, recorded};
}

describe('the deploy scripts', function () {
	it('deploy every contract deterministically, and guard every other transaction', async function () {
		const {provider, env, recorded} = await lanDeploy();
		const transactions = await replayableTransactions(
			provider,
			MNEMONIC_ACCOUNTS,
			env.deployments,
			recorded,
		);
		expect(transactions.length).toBeGreaterThan(0);
	});
});

describe('a setup call, for a LAN box', function () {
	// Against the template's own contract, the way a game's deploy script
	// would tell one contract about another. A repo that replaced it (every
	// game) skips these: the test above checks its own scripts.
	const anyDeployment = (env: any) =>
		Object.values(env.deployments).find((d: any) =>
			d.abi.some((f: any) => f.name === 'setMessage'),
		) as any;

	it('is kept, with its guard, when the execute is guarded', async function (t) {
		const {provider, env, recorded} = await lanDeploy();
		const registry = anyDeployment(env);
		if (!registry) return t.skip('no GreetingsRegistry here');
		const {deployer} = env.namedAccounts;
		await env.execute(registry, {
			account: deployer,
			functionName: 'setMessage',
			args: ['set up'],
			guard: {
				kind: 'call',
				functionName: 'messages',
				args: [deployer],
				equals: 'set up',
			},
		} as any);
		const transactions = await replayableTransactions(
			provider,
			MNEMONIC_ACCOUNTS,
			env.deployments,
			recorded,
		);
		const call = transactions.find((t) => t.kind === 'call');
		expect(call?.kind).toEqual('call');
		if (call?.kind !== 'call') return;
		expect(call.to.toLowerCase()).toEqual(registry.address.toLowerCase());
		expect(call.check.kind).toEqual('call');
		// The guard read, run now, returns what the box will compare against.
		if (call.check.kind !== 'call') return;
		const now = await provider.request({
			method: 'eth_call',
			params: [{to: call.check.to, data: call.check.data}, 'latest'],
		});
		expect(now).toEqual(call.check.result);
	});

	it('is refused when the execute has no guard', async function (t) {
		const {provider, env, recorded} = await lanDeploy();
		const registry = anyDeployment(env);
		if (!registry) return t.skip('no GreetingsRegistry here');
		await env.execute(registry, {
			account: env.namedAccounts.deployer,
			functionName: 'setMessage',
			args: ['unguarded'],
		} as any);
		await expect(
			replayableTransactions(
				provider,
				MNEMONIC_ACCOUNTS,
				env.deployments,
				recorded,
			),
		).toBeRejectedWith(/guard/);
	});
});
