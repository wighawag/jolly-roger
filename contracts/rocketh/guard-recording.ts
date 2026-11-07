/**
 * Lets the LAN build learn the GUARD of every setup call the deploy scripts
 * send (`execute(..., {guard})`), so a LAN box can replay the call only when
 * its effect is missing. The LAN build itself lives in ethereum-lan-node
 * (lib.mkRockethGame, nix/rocketh-game/build/record.ts explains the rest).
 *
 * ONE OF THE TWO HOOKS A REPO HAS TO CARRY for that build, because deploy
 * scripts take `execute` from ./deploy.ts: wrapping the extensions anywhere
 * else does not reach them (the other hook is SOLC_PATH in hardhat.config.ts).
 * A rocketh-level execution listener would make it unnecessary: see
 * rocketh's work/notes/ideas/replayable-deploys.md.
 *
 * `withGuardRecording(extensions)` wraps `execute` and nothing else. The
 * wrapper does NOTHING unless a recorder is installed on `globalThis`, which
 * only the LAN build does: every other deploy, in node or in a browser tab
 * (the embedded chain runs these scripts there), is untouched.
 *
 * Browser-safe on purpose: deploy.ts imports it, and deploy.ts is bundled into
 * the web app wherever the deploy scripts run in a tab.
 */
import {encodeFunctionData, type Abi} from 'viem';

/** How a box tells whether a recorded call has already taken effect. */
export type Check =
	| {kind: 'call'; to: string; data: string; result: string}
	| {kind: 'storage'; to: string; slot: string; word: string};

/** Recorded guarded calls, by transaction hash (lower case). */
export type Recorded = Map<string, Check>;

const KEY = '__rocketh_lan_guarded_calls__';

/** Start (or, with undefined, stop) recording into `recorded`. */
export function installGuardRecorder(recorded: Recorded | undefined): void {
	(globalThis as any)[KEY] = recorded;
}

type Provider = {
	request(args: {method: string; params?: unknown[]}): Promise<unknown>;
};

export function withGuardRecording<T extends object>(extensions: T): T {
	const executeExtension = (extensions as any).execute as
		((env: any) => (deployment: any, args: any) => Promise<any>) | undefined;
	if (typeof executeExtension !== 'function') return extensions;
	const execute = (env: any) => {
		const original = executeExtension(env);
		return async (deployment: any, args: any) => {
			const result = await original(deployment, args);
			const recorded = (globalThis as any)[KEY] as Recorded | undefined;
			const guard = args?.guard;
			if (!recorded || !guard || result?.outcome !== 'sent') return result;
			// The guard read, right after the call landed: what the box compares
			// against, which states the effect exactly, whatever the verdict was.
			const provider = env.network.provider as Provider;
			const target = (guard.on ?? deployment).address as string;
			const hash = String(result.receipt.transactionHash).toLowerCase();
			if (guard.kind === 'storage') {
				const word = (await provider.request({
					method: 'eth_getStorageAt',
					params: [target, guard.slot, 'latest'],
				})) as string;
				recorded.set(hash, {
					kind: 'storage',
					to: target,
					slot: guard.slot,
					word,
				});
			} else {
				const data = encodeFunctionData({
					abi: (guard.on ?? deployment).abi as Abi,
					functionName: guard.functionName,
					args: guard.args ?? [],
				});
				const value = (await provider.request({
					method: 'eth_call',
					params: [{to: target, data}, 'latest'],
				})) as string;
				recorded.set(hash, {kind: 'call', to: target, data, result: value});
			}
			return result;
		};
	};
	return {...extensions, execute};
}
