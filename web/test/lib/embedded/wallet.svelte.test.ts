import {describe, it, expect, afterEach} from 'vitest';
import {startEmbeddedNode} from '$lib/embedded/node';
import {announceEmbeddedWallet} from '$lib/embedded/wallet';

// `.svelte.` infix, so this runs in the `client` project: a real headless
// chromium. It needs one, twice over - the burner keeps its mnemonic in
// localStorage and announces itself over EIP-6963 on `window` - and it is the
// only test here that does.
//
// WHAT IT PINS, and why it is worth a browser: `wallet.ts` contains the one
// cast in `lib/embedded`. `initBurnerWallet` types its `nodeURL` as a string
// and an in-tab chain has no URL, while the implementation underneath takes
// either (it builds its RPC with `createCurriedJSONRPC`). That is a type that
// has not caught up with its own implementation, so the cast is load-bearing
// and invisible: if the package ever makes the type true, nothing fails to
// compile - the wallet simply stops reaching the chain, at runtime, in a tab.
// This is what notices.

const CHAIN_ID = 9007199254740321;

let dispose: (() => Promise<void>) | undefined;
let cleanup: (() => void) | undefined;
afterEach(async () => {
	cleanup?.();
	cleanup = undefined;
	await dispose?.();
	dispose = undefined;
});

describe('the wallet an embedded world announces', () => {
	it('signs for accounts the chain itself cannot name', async () => {
		const node = await startEmbeddedNode({chainId: CHAIN_ID});
		dispose = node.dispose;

		// The node is execution-only and says so, loudly, which is the whole
		// reason a world needs a wallet of its own. Asserting the WORDING rather
		// than a bare -32601 because webevm distinguishes the account methods
		// from a method it simply does not have, and that distinction is the one
		// a reader of this failure needs: nothing is missing, signing is
		// somewhere else.
		await expect(
			node.provider.request({method: 'eth_accounts'}),
		).rejects.toThrow(/execution-only node/i);

		const wallet = await announceEmbeddedWallet({
			provider: node.provider,
			chainId: CHAIN_ID,
		});
		cleanup = wallet.cleanup;

		expect(wallet.accounts.length).toBeGreaterThan(0);
		expect(wallet.accounts[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
	});

	it('reaches THIS chain, through a provider object its type refuses', async () => {
		const node = await startEmbeddedNode({chainId: CHAIN_ID});
		dispose = node.dispose;
		const wallet = await announceEmbeddedWallet({
			provider: node.provider,
			chainId: CHAIN_ID,
		});
		cleanup = wallet.cleanup;

		// Announced, so the app's connection can find it at all.
		const announced = await new Promise<{name: string; rdns: string}[]>(
			(resolve) => {
				const found: {name: string; rdns: string}[] = [];
				const onAnnounce = (event: Event) => {
					const detail = (event as CustomEvent).detail as {
						info: {name: string; rdns: string};
					};
					found.push(detail.info);
				};
				window.addEventListener('eip6963:announceProvider', onAnnounce);
				window.dispatchEvent(new Event('eip6963:requestProvider'));
				setTimeout(() => {
					window.removeEventListener('eip6963:announceProvider', onAnnounce);
					resolve(found);
				}, 50);
			},
		);
		// Its own name and rdns, so it is not a second entry called "Burner
		// Wallet" beside the app's dev burner, pointing at a different chain.
		expect(announced.map((i) => i.name)).toContain('Offline Wallet');
		expect(announced.map((i) => i.rdns)).toContain(
			'dev.etherkit.burner.embedded',
		);
	});
});
