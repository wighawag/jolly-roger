import {describe, it, expect, afterEach} from 'vitest';
import {get} from 'svelte/store';
import {createContext} from '$lib/context/index';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import buildTimeDeployments from '$lib/deployments';
import {config, extensions} from 'jolly-roger-contracts/rocketh/config.js';
import deployGreetingsRegistry from 'jolly-roger-contracts/deploy/001_deploy_greetings_registry.js';

// No `.svelte.` infix, so this runs in the `server` project: node, no DOM.
// That is not a compromise, it is the harness this deserves - webevm's core
// runs under node, so a WHOLE WORLD (a chain, a real deploy, a context built
// on both) is testable without a browser.
//
// WHAT THIS PINS, and why it is the honest measure of this branch:
// `createContext({establishConnection})` has had exactly one caller since the
// parameter landed, and it was the test asserting that core does not reach for
// the remote connection behind the parameter's back. With one world that test
// cannot tell a context describing the world it was given from one describing
// the app's build-time chain, because they are the same. Here they are not:
// the chain id, the contract addresses and the records all differ from the
// generated `$lib/deployments`, so every assertion below fails if the context
// quietly falls back.

const DEPLOYER =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ADMIN =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ADMIN_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// A minted id (see chain-id.ts). Fixed here so the assertions can name it.
const CHAIN_ID = 9007199254740123;

let world: EmbeddedWorld | undefined;
afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

type Provision = Parameters<typeof createEmbeddedWorld>[0]['provision'];

async function buildWorld(overrides?: {provision?: Provision}) {
	return createEmbeddedWorld({
		chainId: CHAIN_ID,
		chain: {
			name: 'Embedded',
			nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
		},
		rocketh: {config, extensions},
		scripts: [
			{id: '001_deploy_greetings_registry', module: deployGreetingsRegistry},
		],
		accounts: {deployer: DEPLOYER, admin: ADMIN},
		initialBalances: {
			[DEPLOYER_ADDRESS]: 10n ** 24n,
			[ADMIN_ADDRESS]: 10n ** 24n,
		},
		...(overrides?.provision ? {provision: overrides.provision} : {}),
	});
}

describe('an embedded world', () => {
	it('boots a chain and runs the app\u2019s real deploy scripts on it', async () => {
		world = await buildWorld();

		// The records come from the deploy that just ran, not from the generated
		// file: a different chain, and a different address for the same contract.
		const inTab = world.deployments.get();
		expect(inTab.chain.id).toBe(CHAIN_ID);
		expect(inTab.chain.id).not.toBe(buildTimeDeployments.chain.id);
		expect(inTab.contracts.GreetingsRegistry.address).toMatch(
			/^0x[0-9a-f]{40}$/,
		);
		expect(inTab.contracts.GreetingsRegistry.address).not.toBe(
			buildTimeDeployments.contracts.GreetingsRegistry.address,
		);

		// And the chain agrees it is that chain.
		const chainId = await world.provider.request({method: 'eth_chainId'});
		expect(BigInt(chainId as string)).toBe(BigInt(CHAIN_ID));
	});

	it('gives the context the world it was handed, member for member', async () => {
		world = await buildWorld();
		const {context} = createContext({
			establishConnection: world.establishConnection,
		});

		// Identity, not equivalence. A core that built its own connection would
		// produce a context that behaves identically against one world and points
		// at the wrong chain the moment there are two.
		expect(context.deployments).toBe(world.deployments);
		expect(get(context.deployments).chain.id).toBe(CHAIN_ID);
		expect(context.publicClient.chain?.id).toBe(CHAIN_ID);
	});

	it('reads the chain in the tab through the context\u2019s own client', async () => {
		world = await buildWorld();
		const {context} = createContext({
			establishConnection: world.establishConnection,
		});

		// The end of the chain of trust: a request made through the context
		// reaches the node this world booted. Nothing is mocked between them -
		// the transport wraps the connection's provider, which wraps the node.
		const deployments = world.deployments.get();
		await expect(
			context.publicClient.getCode({
				address: deployments.contracts.GreetingsRegistry.address,
			}),
		).resolves.toMatch(/^0x[0-9a-f]+$/);
		await expect(context.publicClient.getChainId()).resolves.toBe(CHAIN_ID);
	});

	it('provisions the player after the deploy and before the world exists', async () => {
		// The seam that keeps "what an offline player is given" out of the
		// framework and out of four branches' divergence tables. A commit-reveal
		// game gives its player a stake here; this app has nothing to give, so
		// the test asserts the CONTRACT of the hook rather than an effect: it is
		// handed the deployed environment, and it has run by the time anybody can
		// hold the world.
		let deployedWhenCalled: string | undefined;
		let balanceSet = 0n;
		const provision: Provision = async ({env, node, accounts}) => {
			deployedWhenCalled = (
				env as unknown as {
					deployments: Record<string, {address: string}>;
				}
			).deployments.GreetingsRegistry.address;
			expect(accounts.deployer).toBe(DEPLOYER);
			// It can act on the chain, which is what makes it able to give
			// anything: gas here, an ERC20 stake or an identity token in a game.
			await node.provider.request({
				method: 'evm_setBalance',
				params: [ADMIN_ADDRESS, '0x2710'],
			});
			balanceSet = 10000n;
		};

		world = await buildWorld({provision});

		expect(deployedWhenCalled).toBe(
			world.deployments.get().contracts.GreetingsRegistry.address,
		);
		expect(balanceSet).toBe(10000n);
		const balance = await world.provider.request({
			method: 'eth_getBalance',
			params: [ADMIN_ADDRESS, 'latest'],
		});
		expect(BigInt(balance as string)).toBe(10000n);
	});
});
