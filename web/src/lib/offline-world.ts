import {writable, type Readable} from 'svelte/store';
import {createIndexedDBDeploymentStore} from '@rocketh/web';
import {
	createEmbeddedWorld,
	restoreIsCoherent,
	type EmbeddedWorld,
	type EmbeddedWorldSpec,
	type ProvisionParams,
} from '$lib/embedded';
import type {ProvisionResult} from '$lib/embedded/world';
import {mintChainId, rememberChainId} from '$lib/embedded/chain-id';
import {startEmbeddedNode} from '$lib/embedded/node';
import {offlineWorldNode} from '$lib/offline-node';
import type {Context} from '$lib/context/types';

/**
 * AN OFFLINE WORLD'S BOOT, THE HALF EVERY APP'S IS THE SAME: open the world,
 * keep its boot, and connect its wallet.
 *
 * `$lib/embedded` is the mechanism (a chain in the tab, a deploy on it, a
 * connection to it) and knows nothing of this app's worker or of where a
 * browser remembers its world. `$lib/offline` is the app's composition: WHICH
 * scripts, WHICH accounts, what a player is given. This module is between the
 * two, and it exists because every app built from this template wrote it again:
 * the same opener, the same memo, the same connect, copied into each game's
 * `offline.ts` with four things changed. Those four are its parameters; the
 * rest is here once.
 *
 * Every name a world persists under (the chain id's key, the two databases) is
 * a WIRE: a world a browser already holds must restore across any change to
 * this file, so the key is the caller's and the database names are the ones
 * every copy has always used.
 */

/** What a world deploys, and who it deploys as. Everything else is the opener's. */
export type OfflineWorldDeployment = Pick<
	EmbeddedWorldSpec,
	| 'rocketh'
	| 'scripts'
	| 'accounts'
	| 'environment'
	| 'data'
	| 'initialBalances'
	| 'expectedContracts'
>;

export type OpenOfflineWorldParams = {
	/**
	 * Where this browser remembers its world's chain id. The caller's, and a
	 * wire: changing it starts every player's world again.
	 */
	chainIdKey: string;
	deployment: OfflineWorldDeployment;
	/**
	 * The chain's own properties, usually the deploy config's for the local
	 * chain (what denominates gas in a game's units). Two are always replaced:
	 * see {@link OFFLINE_CHAIN_TIMING}.
	 */
	chainProperties?: Record<string, unknown>;
	/**
	 * Everything the player is given before they start, run once the deploy has.
	 * The mechanism's hook, told the world's chain id as well.
	 */
	provision?: (
		params: ProvisionParams & {chainId: number},
	) => Promise<ProvisionResult>;
	/** What the boot is doing, for the page to say while it waits. */
	onStep?: (what: string) => void;
	/** Defaults to `localStorage`. */
	storage?: {
		getItem(key: string): string | null;
		setItem(key: string, value: string): void;
	};
};

/**
 * THE TWO PROPERTIES EVERY IN-TAB CHAIN HAS, whatever the deploy config says.
 *
 * A block exists only where a transaction happened, so a "block time" here
 * measures how long the player thought about their move. One second is the
 * honest floor to give anything that polls.
 *
 * ZERO CONFIRMATIONS, and it is the honest number rather than a workaround. The
 * observer's test is `latestBlockNumber - blockNumber >= finality`, and under
 * automine the NEWEST transaction is always in the latest block, so a
 * confirmation above it never arrives. Measured: with `finality: 1` an
 * operation sits in the account ledger forever as `{inclusion: 'Included',
 * outcome: 'Success', final: false}`; with zero it completes and is retired.
 * (It is NOT what once left every transaction spinning: that was the tab-leader
 * namespace in `context/core.ts`, and the spinner is about inclusion.)
 * Confirmations buy protection from a REORG, and a chain in one tab has no
 * competing producer to reorg it; the only way its state goes backwards is
 * `loadState`, an explicit rewind by the world's own owner, which no number of
 * confirmations defends against.
 */
export const OFFLINE_CHAIN_TIMING = {averageBlockTimeMs: 1000, finality: 0};

/**
 * Boot (or restore) this browser's offline world.
 *
 * PERSISTED BY DEFAULT, which is the answer to "should an offline game come
 * back when you reload". Yes, and it costs nothing to say so: webevm dumps its
 * state to IndexedDB and `@rocketh/web` keeps the deployment records the same
 * way, so a reload restores the chain AND skips the deploy rather than building
 * a second game beside the first. Both are namespaced by the chain id, so two
 * worlds never share a database.
 *
 * It is also what makes the operations ledger honest. That ledger already
 * persists (keyed by chain id), and without a persisted chain it would come
 * back describing transactions on a chain that no longer exists. Persisting the
 * chain and persisting the pending transactions are not two decisions.
 *
 * The id is minted once and remembered under `chainIdKey`, because it is what
 * keys everything the player keeps (see `$lib/embedded/chain-id`); on an
 * incoherent restore a new one is minted and remembered there instead.
 */
export async function openOfflineWorld(
	params: OpenOfflineWorldParams,
): Promise<EmbeddedWorld> {
	const storage = params.storage ?? localStorage;
	const chainId = rememberChainId({storage, key: params.chainIdKey});
	return openAt(chainId, params, storage);
}

async function openAt(
	chainId: number,
	params: OpenOfflineWorldParams,
	storage: NonNullable<OpenOfflineWorldParams['storage']>,
): Promise<EmbeddedWorld> {
	const {deployment, provision, onStep} = params;
	onStep?.('starting a chain in this tab');

	const deploymentStore = await createIndexedDBDeploymentStore({
		db: `offline-world-deployments:${chainId}`,
	});

	// THE RESTORE IS CHECKED BEFORE ANYTHING IS DEPLOYED. Three stores persist
	// independently and nothing makes them atomic; records that outlive their
	// chain make rocketh skip a deploy it believes it has done, and the script
	// then reads a contract that is not there. Asking afterwards is too late:
	// the boot throws first, which is how this was found.
	//
	// A NEW ID rather than a repair. Everything the player kept is keyed by the
	// chain id (the operations ledger, and in a game its submissions), so
	// reusing it would mix records describing a chain that no longer exists
	// into one that does. Minting orphans them instead, which is what they are.
	//
	// THE PROBE RUNS WHERE THE WORLD'S NODE WILL (a Worker, in a browser), so
	// loading the dump does not stall the page either, and it is GONE before
	// the real node opens the same database: disposed, every request it was
	// sent settled, and its Worker terminated (`released`). It only reads, so
	// nothing of it could be saved over the real node's chain anyway; waiting
	// is what makes that a fact rather than an argument. See `$lib/offline-node`.
	const db = `offline-world-chain:${chainId}`;
	const probeNode = offlineWorldNode({db});
	const probe = await startEmbeddedNode({
		chainId,
		createNode: probeNode.createNode,
		persistence: probeNode.persistence,
	});
	const coherent = await restoreIsCoherent({
		provider: probe.provider,
		vfs: deploymentStore.vfs,
	}).finally(() => probe.dispose());
	await probeNode.released();
	if (!coherent) {
		onStep?.('starting a fresh chain');
		const fresh = mintChainId();
		storage.setItem(params.chainIdKey, String(fresh));
		return openAt(fresh, params, storage);
	}

	const worldNode = offlineWorldNode({db});
	return createEmbeddedWorld({
		chainId,
		chain: {
			name: 'Offline',
			nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
			properties: {...params.chainProperties, ...OFFLINE_CHAIN_TIMING},
		},
		rocketh: deployment.rocketh,
		...(deployment.environment !== undefined
			? {environment: deployment.environment}
			: {}),
		scripts: [...deployment.scripts],
		...(deployment.data ? {data: {...deployment.data}} : {}),
		accounts: {...deployment.accounts},
		...(deployment.initialBalances
			? {initialBalances: {...deployment.initialBalances}}
			: {}),
		...(deployment.expectedContracts
			? {expectedContracts: [...deployment.expectedContracts]}
			: {}),
		// IN A WORKER whenever there is one, with its IndexedDB persistence built
		// inside it; on this thread otherwise. See `$lib/offline-node`.
		createNode: worldNode.createNode,
		persistence: worldNode.persistence,
		deploymentStore,
		...(provision
			? {provision: (provisioning) => provision({...provisioning, chainId})}
			: {}),
	});
}

export type OfflineBootStatus<Ready extends object> =
	| {step: 'Idle'}
	| {step: 'Booting'; what: string}
	| ({step: 'Ready'} & Ready)
	| {step: 'Failed'; error: string};

export type OfflineBoot<Ready extends object, Args extends unknown[]> = {
	/** What the page renders. */
	status: Readable<OfflineBootStatus<Ready>>;
	/** Boot, or join the boot already started. Never rejects: a failure is `Failed`. */
	start(...args: Args): Promise<OfflineBootStatus<Ready>>;
	/** The boot in flight or done, if any: what letting go of the world waits on. */
	current(): Promise<OfflineBootStatus<Ready>> | undefined;
};

/**
 * THE WORLD'S BOOT, KEPT: one per app, lazy, and retried after a failure.
 *
 * Lazy because nothing may happen at import time: a world reaches for
 * IndexedDB-shaped things and announces a wallet on `window`, and the app
 * prerenders (ADR-0002). Nothing runs until a page starts it.
 *
 * App-scoped because a world is STATE, not a view. Route-scoped would boot a
 * fresh chain on every navigation, so visiting another page and coming back
 * would be a new game: the player's own chain, thrown away by the router. So a
 * second `start` joins the first, whatever it is given (a world that is
 * already building keeps what it was started with).
 *
 * A FAILED BOOT IS DROPPED so a retry is possible: a failure is usually a
 * missing dependency or a deploy script throwing, and both are things a
 * developer fixes and reloads into.
 *
 * `build` reports its steps through `booting` and returns what `Ready`
 * carries; the status is `Ready` once it has returned.
 */
export function createOfflineBoot<
	Ready extends object,
	Args extends unknown[] = [],
>(
	build: (booting: (what: string) => void, ...args: Args) => Promise<Ready>,
): OfflineBoot<Ready, Args> {
	const status = writable<OfflineBootStatus<Ready>>({step: 'Idle'});
	const booting = (what: string) => status.set({step: 'Booting', what});
	let pending: Promise<OfflineBootStatus<Ready>> | undefined;

	return {
		status: {subscribe: status.subscribe},
		start(...args) {
			if (!pending) {
				pending = build(booting, ...args).then(
					(ready) => {
						const value = {...ready, step: 'Ready'} as OfflineBootStatus<Ready>;
						status.set(value);
						return value;
					},
					(err: unknown) => {
						pending = undefined;
						const failure: OfflineBootStatus<Ready> = {
							step: 'Failed',
							error: err instanceof Error ? err.message : String(err),
						};
						status.set(failure);
						return failure;
					},
				);
			}
			return pending;
		},
		current: () => pending,
	};
}

/**
 * CONNECT THE WORLD'S OWN WALLET, and sign in with it when the app signs in.
 *
 * Connecting is normally the player's decision because it is a question: WHICH
 * wallet, which account, and do you want this site to see it. A world that
 * brought its own wallet has already answered all three: there is one wallet,
 * it holds one account, it signs without asking, and it exists nowhere but this
 * tab. So the world connects itself, at boot, rather than waiting for the
 * player's first action to do it.
 *
 * THE SIGN-IN IS ASKED FOR HERE because nothing else would ask. The connection
 * takes the app's `targetStep`; where that is `SignedIn`, `ensureConnected()`
 * alone connects the wallet and then waits at `WalletConnected` forever, since
 * the step after it is a SIGNATURE, and in the app that is the "Sign In" button
 * of a connection flow that a world's page does not mount. Here asking is honest
 * rather than a shortcut: the message is origin-scoped, and the wallet that
 * signs it was generated by this world, holds one account, exists in no other
 * tab and auto-approves by declaration (`WalletInfo.autoApproves`). What the
 * signature buys is what it buys online: the local signer this browser plays
 * with, derived from it.
 *
 * `'WalletConnected'` is named for the first step because the target cannot be
 * reached without help; `core/connection/ensure-can-sign.ts` uses the same
 * two-step shape on a `SignedIn` connection, for the different reason that
 * paying only needs a wallet.
 *
 * It throws what the connection throws: whether a failed connect is fatal is
 * the caller's to say (a world, its chain and its deploy are fine without one).
 */
export async function connectTheWorld(
	connection: Pick<
		Context['connection'],
		'ensureConnected' | 'requestSignature' | 'targetStep'
	>,
): Promise<void> {
	await connection.ensureConnected('WalletConnected');
	if (connection.targetStep === 'SignedIn') {
		await connection.requestSignature();
	}
}
