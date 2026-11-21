import type {Readable} from 'svelte/store';
import {config, extensions} from 'jolly-roger-contracts/rocketh/config.js';
import deployGreetingsRegistry from 'jolly-roger-contracts/deploy/001_deploy_greetings_registry.js';
import type {EmbeddedWorld} from '$lib/embedded';
import {announceEmbeddedWallet} from '$lib/embedded/wallet';
import {createWorldClaim, letGoOfWorld} from '$lib/embedded/claim';
import {
	connectTheWorld,
	createOfflineBoot,
	openOfflineWorld,
	type OfflineBootStatus,
} from '$lib/offline-world';
import {authoriseTheBrowsersKey} from '$lib/ui/delegation/authorise-here';
import {createContext} from '$lib/context/index';
import type {Context} from '$lib/context/types';

/**
 * THIS APP'S OFFLINE WORLD: the composition, which is the half `lib/embedded`
 * deliberately does not have.
 *
 * `embedded-chain` is the MECHANISM and belongs to the framework; `offline` is
 * the EXPERIENCE a player chooses and belongs to the app, exactly as `turn`
 * does. So the framework knows how to boot a chain and run deploy scripts on
 * it, and this file knows WHICH scripts, WHICH accounts, and what a player of
 * THIS app is given before they start. A game built from this template
 * replaces this file and keeps everything under `lib/embedded`, and the boot
 * every app's world shares (the opener, the memo, the world's connect) in
 * `lib/offline-world`.
 *
 * It lives beside `lib/index.ts` rather than in a route for the reason the
 * branch README gives: a descendant deletes the demo routes it inherits, and
 * anything world-building inside one is thrown away with them.
 */

/**
 * The keys the deploy signs with, and they are PUBLIC AND FIXED on purpose.
 *
 * These are hardhat's well-known development accounts. There is nothing to
 * protect: the chain exists only in this tab, it has no bridge to anywhere,
 * and its ether is a number this file could set to anything with a cheat
 * call. Generating a key per world would buy no security and would cost the
 * one thing that matters here - a world's contract addresses would change
 * between runs, so nothing could be reasoned about or written down.
 *
 * The PLAYER does not use these. They play through the announced wallet (see
 * `lib/embedded/wallet.ts`), which holds its own mnemonic.
 */
const DEPLOYER =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const ADMIN =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ADMIN_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

const CHAIN_ID_STORAGE_KEY = 'offline-world:chain-id';
const PLAY_MONEY = 10n ** 24n;

export type OfflineWorldStatus = OfflineBootStatus<{
	world: EmbeddedWorld;
	context: {context: Context; start: () => () => void};
}>;

/**
 * APP-SCOPED AND LAZY: one boot for the app, started by the page that shows
 * the world and kept across navigation. See `createOfflineBoot`.
 */
const boot = createOfflineBoot(buildOfflineWorld);

/** What the page renders. */
export const offlineWorld: Readable<OfflineWorldStatus> = boot.status;

/**
 * ONE TAB AT A TIME, named by this app's world rather than by its chain id.
 *
 * This browser keeps one world (one `CHAIN_ID_STORAGE_KEY`), and the id changes
 * inside a boot when a restore is incoherent, so the lock is the world's
 * namespace and not the id; `$lib/embedded/claim` has the measurement. Letting go
 * is waiting for whatever boot this tab started, then the mechanism's barrier.
 */
export const offlineWorldClaim = createWorldClaim({
	name: 'offline-world',
	letGo: () => letGoOfWorld(boot.current()),
});

/**
 * What a page that owns the world does on mount: claim it, and boot it only if
 * this tab has it. A refused tab boots nothing, and the page shows the claim's
 * refusal instead.
 */
export async function enterOfflineWorld(): Promise<void> {
	if (await offlineWorldClaim.claim()) await startOfflineWorld();
}

/** Ask the tab that has the world for it, and boot it here by the ordinary restore. */
export async function takeTheOfflineWorldOver(): Promise<void> {
	await offlineWorldClaim.takeOver();
	await startOfflineWorld();
}

export function startOfflineWorld(): Promise<OfflineWorldStatus> {
	return boot.start();
}

async function buildOfflineWorld(booting: (what: string) => void) {
	// Persisted, restored, and refused when incoherent: see `$lib/offline-world`.
	const world = await openOfflineWorld({
		chainIdKey: CHAIN_ID_STORAGE_KEY,
		deployment: {
			rocketh: {config, extensions},
			scripts: [
				{id: '001_deploy_greetings_registry', module: deployGreetingsRegistry},
			],
			accounts: {deployer: DEPLOYER, admin: ADMIN},
			initialBalances: {
				[DEPLOYER_ADDRESS]: PLAY_MONEY,
				[ADMIN_ADDRESS]: PLAY_MONEY,
			},
		},
		onStep: booting,
		async provision({node, chainId}) {
			booting('handing the player a wallet');

			// THE PROVISIONING SEAM, and this app's answer to it is the smallest
			// possible one: gas. A commit-reveal game's answer is longer - an
			// ERC20 stake bonded at commit time, or an identity token the player
			// must own - and it is written HERE, in the app, rather than in the
			// framework or per branch.
			const wallet = await announceEmbeddedWallet({
				provider: node.provider,
				chainId,
			});
			announced = wallet.cleanup;

			for (const account of wallet.accounts) {
				await node.provider.request({
					method: 'evm_setBalance',
					params: [account, `0x${PLAY_MONEY.toString(16)}`],
				});
			}

			// HANDED BACK rather than announced-and-hoped-for. The connection
			// this world builds will use exactly this wallet, so the player is
			// never asked to choose one - and cannot choose a wallet that has
			// no account on this chain, which is every other wallet they own.
			return {wallets: [wallet.handle]};
		},
	});

	booting('connecting');

	// SYNCHRONOUS, AND AFTER THE WORLD, which is the shape the whole design
	// turns on. The context cannot be built first and filled in: it reads a
	// contract address out of `deployments` while constructing, to scope the
	// operations ledger, and before the deploy there is no address to give it.
	// ADR-0002 is untouched - the app-level context in `+layout.svelte` is
	// still built synchronously during prerender, because that one is the
	// remote world.
	const context = createContext({
		establishConnection: world.establishConnection,
	});

	// Dev/debug: the world on the console, beside the `context` handle
	// `core.ts` installs. Worth having for a world specifically, because the
	// only way to look at a chain in a tab is to hold it: there is no RPC url
	// to curl, no explorer, and no second process that can see it.
	if (typeof window !== 'undefined') {
		try {
			(globalThis as unknown as Record<string, unknown>).offlineWorld = {
				world,
				context: context.context,
			};
		} catch {
			// A console convenience is never worth failing a boot for.
		}
	}

	// AND IT CONNECTS ITSELF, AT BOOT, so the page shows the world's account at
	// once rather than at the player's first send (see `connectTheWorld`).
	// NOT FATAL: the world, the chain and the deploy are fine without a
	// connection, and the demo's own send connects again when asked.
	try {
		await connectTheWorld(context.context.connection);
	} catch (err) {
		console.error('the offline world could not connect its own wallet', err);
	}

	// AND IT AUTHORISES THE KEY THIS BROWSER SENDS WITH, which on this branch is
	// the last thing standing between the player and a send: the local signer
	// is derived from the signature the line above asked for, and acts only once
	// the account has registered it as a delegate. The world's account is the
	// world's own wallet, so there is nobody to ask (see `authorise-here.ts`).
	// NOT FATAL: refused, the app's own authorisation flow comes back at the
	// first send, the remedy a player would have had anyway.
	booting("authorising this browser's key");
	try {
		const outcome = await authoriseTheBrowsersKey(context.context);
		if (outcome.step === 'Refused') {
			console.error(
				`the offline world could not authorise this browser's key: ${outcome.reason}`,
			);
		}
	} catch (err) {
		console.error(
			"the offline world could not authorise this browser's key",
			err,
		);
	}

	return {world, context};
}

let announced: (() => void) | undefined;

/**
 * Stop announcing the offline wallet.
 *
 * NOT a teardown of the world, deliberately: the chain outlives the page that
 * showed it, and disposing of it on unmount is how a router deletes somebody's
 * world.
 */
export function stopAnnouncingOfflineWallet(): void {
	announced?.();
	announced = undefined;
}
