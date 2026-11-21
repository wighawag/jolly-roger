import 'fake-indexeddb/auto';
import {describe, it, expect, afterEach, vi} from 'vitest';
import {get} from 'svelte/store';
import type {EmbeddedWorld} from '$lib/embedded';
import {createIndexedDBDeploymentStore} from '@rocketh/web';
import {isEmbeddedChainId, mintChainId} from '$lib/embedded/chain-id';
import {
	connectTheWorld,
	createOfflineBoot,
	openOfflineWorld,
	type OfflineWorldDeployment,
} from '$lib/offline-world';
import {config, extensions, APP_SCRIPTS, APP_CONTRACT} from './app-world';

// No `.svelte.` infix: the `server` project, in node, which has no `Worker`, so
// the world's node runs on this thread and persists in `fake-indexeddb`. That
// is the same opener a browser runs, with the same databases, minus the Worker
// (whose own behaviour `offline-node.test.ts` pins).

// THE DEPLOYER AND THE ADMIN, both funded, as `embedded/world.test.ts` deploys:
// the two named accounts a deploy config of this tree declares. A descendant's
// `APP_SCRIPTS` (`./app-world`) may need either (template-commit-reveal's game
// is owned by its admin), and a world of the deployer alone leaves the admin
// unresolved there.
const DEPLOYER =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ADMIN =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const ADMIN_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

const DEPLOYMENT: OfflineWorldDeployment = {
	rocketh: {config, extensions},
	scripts: APP_SCRIPTS,
	accounts: {deployer: DEPLOYER, admin: ADMIN},
	initialBalances: {
		[DEPLOYER_ADDRESS]: 10n ** 24n,
		[ADMIN_ADDRESS]: 10n ** 24n,
	},
};

/** A browser's `localStorage`, as much of it as the opener uses. */
function memoryStorage() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		items,
	};
}

const opened: EmbeddedWorld[] = [];
afterEach(async () => {
	for (const world of opened.splice(0)) await world.dispose().catch(() => {});
});

async function open(params: {
	storage: ReturnType<typeof memoryStorage>;
	key: string;
	steps?: string[];
	provisioned?: number[];
}) {
	const world = await openOfflineWorld({
		chainIdKey: params.key,
		storage: params.storage,
		deployment: DEPLOYMENT,
		// The deploy config's own properties, of which the opener keeps all but
		// the two an in-tab chain always overrides.
		chainProperties: {averageBlockTimeMs: 12000, finality: 3, gameUnit: 7},
		onStep: (what) => params.steps?.push(what),
		provision: async ({chainId}) => {
			params.provisioned?.push(chainId);
		},
	});
	opened.push(world);
	return world;
}

async function blockNumber(world: EmbeddedWorld) {
	return BigInt(
		(await world.provider.request({method: 'eth_blockNumber'})) as string,
	);
}

/** Dispose of a world before opening it again, as a reload does. */
async function close(world: EmbeddedWorld) {
	opened.splice(opened.indexOf(world), 1);
	await world.dispose();
}

describe('openOfflineWorld', () => {
	it('mints a chain id, remembers it under the given key, and deploys there', async () => {
		const storage = memoryStorage();
		const steps: string[] = [];
		const provisioned: number[] = [];
		const world = await open({
			storage,
			key: 'offline-world-test:first',
			steps,
			provisioned,
		});

		expect(isEmbeddedChainId(world.chainId)).toBe(true);
		expect(storage.items.get('offline-world-test:first')).toBe(
			String(world.chainId),
		);
		expect(world.deployments.get().chain.id).toBe(world.chainId);
		expect(world.deployments.get().chain.name).toBe('Offline');
		expect(world.deployments.get().chain.properties).toEqual({
			gameUnit: 7,
			averageBlockTimeMs: 1000,
			finality: 0,
		});
		const address = world.deployments.get().contracts[APP_CONTRACT].address;
		const code = await world.provider.request({
			method: 'eth_getCode',
			params: [address, 'latest'],
		});
		expect(code).not.toBe('0x');
		// The provision hook is told the id, which the mechanism's own hook is not.
		expect(provisioned).toEqual([world.chainId]);
		expect(steps[0]).toBe('starting a chain in this tab');
	});

	it('restores the remembered world on a second open, deploying nothing again', async () => {
		const storage = memoryStorage();
		const first = await open({storage, key: 'offline-world-test:restore'});
		const address = first.deployments.get().contracts[APP_CONTRACT].address;
		const head = await blockNumber(first);
		expect(head).toBeGreaterThan(0n);
		await close(first);

		const steps: string[] = [];
		const again = await open({
			storage,
			key: 'offline-world-test:restore',
			steps,
		});
		expect(again.chainId).toBe(first.chainId);
		expect(again.deployments.get().contracts[APP_CONTRACT].address).toBe(
			address,
		);
		// The same chain, not a second deploy on a fresh one.
		expect(await blockNumber(again)).toBe(head);
		expect(steps).not.toContain('starting a new world');
	});

	it('refuses an incoherent restore: a new id, remembered, and a fresh deploy', async () => {
		// Records that outlive their chain, the restore the opener must not trust:
		// this browser remembers a world whose deployment store holds a record
		// and whose chain has no block beyond genesis.
		const storage = memoryStorage();
		const remembered = mintChainId();
		storage.setItem('offline-world-test:incoherent', String(remembered));
		const records = await createIndexedDBDeploymentStore({
			db: `offline-world-deployments:${remembered}`,
		});
		await records.writeFile(
			'deployments',
			'offline',
			`${APP_CONTRACT}.json`,
			'{}',
		);
		const first = {chainId: remembered};

		const steps: string[] = [];
		const provisioned: number[] = [];
		const again = await open({
			storage,
			key: 'offline-world-test:incoherent',
			steps,
			provisioned,
		});
		expect(again.chainId).not.toBe(first.chainId);
		expect(isEmbeddedChainId(again.chainId)).toBe(true);
		expect(storage.items.get('offline-world-test:incoherent')).toBe(
			String(again.chainId),
		);
		expect(steps).toContain('starting a new world');
		expect(provisioned).toEqual([again.chainId]);
		const address = again.deployments.get().contracts[APP_CONTRACT].address;
		expect(
			await again.provider.request({
				method: 'eth_getCode',
				params: [address, 'latest'],
			}),
		).not.toBe('0x');
	});
});

describe('createOfflineBoot', () => {
	it('is Idle until started, reports its steps, and is Ready with what the build returned', async () => {
		const boot = createOfflineBoot(async (booting) => {
			booting('one');
			expect(get(boot.status)).toEqual({step: 'Booting', what: 'one'});
			return {answer: 42};
		});
		expect(get(boot.status)).toEqual({step: 'Idle'});
		expect(boot.current()).toBeUndefined();

		const result = await boot.start();
		expect(result).toEqual({step: 'Ready', answer: 42});
		expect(get(boot.status)).toEqual({step: 'Ready', answer: 42});
	});

	it('builds once however often it is started, and hands every caller the same boot', async () => {
		const build = vi.fn(
			async (_booting: (what: string) => void, n: number) => ({
				n,
			}),
		);
		const boot = createOfflineBoot(build);
		const a = boot.start(1);
		const b = boot.start(2);
		expect(boot.current()).toBe(a);
		expect(b).toBe(a);
		expect(await a).toEqual({step: 'Ready', n: 1});
		expect(await boot.start(3)).toEqual({step: 'Ready', n: 1});
		expect(build).toHaveBeenCalledTimes(1);
	});

	it('fails as Failed with the message, and builds again on the next start', async () => {
		let attempt = 0;
		const boot = createOfflineBoot(async () => {
			attempt++;
			if (attempt === 1) throw new Error('a deploy script threw');
			return {attempt};
		});
		expect(await boot.start()).toEqual({
			step: 'Failed',
			error: 'a deploy script threw',
		});
		expect(get(boot.status)).toEqual({
			step: 'Failed',
			error: 'a deploy script threw',
		});
		expect(boot.current()).toBeUndefined();

		expect(await boot.start()).toEqual({step: 'Ready', attempt: 2});
	});
});

describe('connectTheWorld', () => {
	function fakeConnection(targetStep: 'WalletConnected' | 'SignedIn') {
		const calls: string[] = [];
		return {
			calls,
			connection: {
				targetStep,
				ensureConnected: async (step?: string) => {
					calls.push(`ensureConnected:${step}`);
				},
				requestSignature: async () => {
					calls.push('requestSignature');
				},
			},
		};
	}

	it('connects the wallet and stops there when the app targets WalletConnected', async () => {
		const fake = fakeConnection('WalletConnected');
		await connectTheWorld(fake.connection as never);
		expect(fake.calls).toEqual(['ensureConnected:WalletConnected']);
	});

	it('connects, then asks the world\u2019s own wallet for the sign-in when the app targets SignedIn', async () => {
		const fake = fakeConnection('SignedIn');
		await connectTheWorld(fake.connection as never);
		expect(fake.calls).toEqual([
			'ensureConnected:WalletConnected',
			'requestSignature',
		]);
	});
});
