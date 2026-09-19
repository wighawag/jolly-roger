import {writable, type Readable} from 'svelte/store';
import {config, extensions} from 'jolly-roger-contracts/rocketh/config.js';
import deployGreetingsRegistry from 'jolly-roger-contracts/deploy/001_deploy_greetings_registry.js';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import {rememberChainId} from '$lib/embedded/chain-id';
import {announceEmbeddedWallet} from '$lib/embedded/wallet';
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
 * replaces this file and keeps everything under `lib/embedded`.
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

export type OfflineWorldStatus =
	| {step: 'Idle'}
	| {step: 'Booting'; what: string}
	| {
			step: 'Ready';
			world: EmbeddedWorld;
			context: {context: Context; start: () => () => void};
	  }
	| {step: 'Failed'; error: string};

const status = writable<OfflineWorldStatus>({step: 'Idle'});

/** What the page renders. */
export const offlineWorld: Readable<OfflineWorldStatus> = {
	subscribe: status.subscribe,
};

/**
 * APP-SCOPED AND LAZY, and the lifetime is the decision rather than the
 * laziness.
 *
 * Lazy because nothing may happen at import time: this module reaches for
 * IndexedDB-shaped things and announces a wallet on `window`, and the app
 * prerenders (ADR-0002). Nothing here runs until a page asks.
 *
 * App-scoped because a world is STATE, not a view. Route-scoped would boot a
 * fresh chain on every navigation, so visiting another page and coming back
 * would be a new game - the player's own chain, thrown away by the router.
 * Boot plus a real deploy is 89-101ms measured in node, so this is not a
 * performance decision in either direction.
 */
let pending: Promise<OfflineWorldStatus> | undefined;

export function startOfflineWorld(): Promise<OfflineWorldStatus> {
	if (!pending) {
		pending = buildOfflineWorld().catch((err) => {
			// The promise is dropped so a retry is possible: a failed boot is
			// usually a missing dependency or a deploy script throwing, and both
			// are things a developer fixes and reloads into.
			pending = undefined;
			const failure: OfflineWorldStatus = {
				step: 'Failed',
				error: err instanceof Error ? err.message : String(err),
			};
			status.set(failure);
			return failure;
		});
	}
	return pending;
}

async function buildOfflineWorld(): Promise<OfflineWorldStatus> {
	// The id is minted once and remembered, because it is what keys everything
	// the player keeps. See `lib/embedded/chain-id.ts`.
	const chainId = rememberChainId({
		storage: localStorage,
		key: CHAIN_ID_STORAGE_KEY,
	});

	status.set({step: 'Booting', what: 'starting a chain in this tab'});

	const world = await createEmbeddedWorld({
		chainId,
		chain: {
			name: 'Offline',
			nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
			properties: {
				// A block exists only where a transaction happened, so a "block
				// time" here measures how long the player thought about their
				// move. One second is the honest floor to give anything that
				// polls, and nothing on this branch reads it for a deadline.
				averageBlockTimeMs: 1000,
				finality: 1,
			},
		},
		rocketh: {config, extensions},
		scripts: [
			{id: '001_deploy_greetings_registry', module: deployGreetingsRegistry},
		],
		accounts: {deployer: DEPLOYER, admin: ADMIN},
		initialBalances: {
			[DEPLOYER_ADDRESS]: PLAY_MONEY,
			[ADMIN_ADDRESS]: PLAY_MONEY,
		},
		async provision({node}) {
			status.set({step: 'Booting', what: 'handing the player a wallet'});

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
		},
	});

	status.set({step: 'Booting', what: 'connecting'});

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

	const ready: OfflineWorldStatus = {step: 'Ready', world, context};
	status.set(ready);
	return ready;
}

let announced: (() => void) | undefined;

/**
 * Stop announcing the offline wallet.
 *
 * NOT a teardown of the world, deliberately: the chain outlives the page that
 * showed it, and disposing of it on unmount is how a router deletes somebody's
 * game.
 */
export function stopAnnouncingOfflineWallet(): void {
	announced?.();
	announced = undefined;
}
