import {describe, it, expect, afterEach} from 'vitest';
import {createWalletClient, custom, parseEther, toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {startEmbeddedNode, type EmbeddedNode} from '$lib/embedded/node';

// No `.svelte.` infix: the `server` project, in node, where webevm's core runs.
//
// A READ PINNED TO A BLOCK THE CHAIN HAS ALREADY MOVED PAST, which is what a
// polling reader does when several reads must describe one block (downstream,
// template-commit-reveal's `onchain/state.ts` reads the head and its games pin
// each `readContract` batch to it). On an
// automined chain in the tab a block appears whenever anyone sends anything (a
// seat the world plays, the player's own commit), so the head routinely moves
// between the two. Up to webevm 0.7.0 the node ignored the pin and answered from
// the head; since 0.8.0 it refuses a state read below the head unless the node
// keeps a window of history (`-32000 historical state not available`), and the
// poll then failed and backed off behind the health banner. Found reviewing the
// webevm 0.9.0 cascade (2026-10-26).

const KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ACCOUNT = privateKeyToAccount(KEY);
const RECIPIENT = '0x00000000000000000000000000000000000c0ffe' as const;

let node: EmbeddedNode | undefined;
afterEach(async () => {
	await node?.dispose();
	node = undefined;
});

async function sendOne(target: EmbeddedNode) {
	const wallet = createWalletClient({
		account: ACCOUNT,
		chain: {
			id: target.chainId,
			name: 'test',
			nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
			rpcUrls: {default: {http: []}},
		},
		transport: custom(target.provider as never),
	});
	await wallet.sendTransaction({to: RECIPIENT, value: parseEther('1')});
}

describe('the embedded node', () => {
	it('answers a read pinned to a block the head has moved past', async () => {
		node = await startEmbeddedNode({
			chainId: 31337,
			initialBalances: {[ACCOUNT.address]: parseEther('10')},
		});
		await sendOne(node);
		const pinned = (await node.provider.request({
			method: 'eth_blockNumber',
		})) as `0x${string}`;
		// the chain moves on between reading the head and reading at it
		await sendOne(node);
		expect(
			BigInt(
				(await node.provider.request({method: 'eth_blockNumber'})) as string,
			),
		).toBe(BigInt(pinned) + 1n);

		const balance = await node.provider.request({
			method: 'eth_getBalance',
			params: [RECIPIENT, pinned],
		});
		expect(balance).toBe(toHex(parseEther('1')));

		const call = await node.provider.request({
			method: 'eth_call',
			params: [{to: RECIPIENT, data: '0x'}, pinned],
		});
		expect(call).toBe('0x');
	});
});
