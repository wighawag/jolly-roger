import {initBurnerWallet} from '@etherkit/burner-wallet';
import type {EIP1193ProviderLike} from './types.js';

/**
 * WHO SIGNS IN AN EMBEDDED WORLD, and why it is a burner rather than the local
 * signer this tree spent a phase on.
 *
 * webevm holds no keys - `eth_accounts`, `eth_sendTransaction` and `eth_sign`
 * are a real `-32601` - so a world needs a wallet of its own, and the burner
 * is exactly one: a mnemonic in localStorage, announced over EIP-6963, which
 * signs locally and sends `eth_sendRawTransaction`.
 *
 * THE LOCAL SIGNER WOULD BUY NOTHING HERE, which is worth stating because it
 * is upstream and it would be the obvious reach. Its value is that it is
 * RECOVERABLE: derived from a wallet signature, so the same account re-derives
 * the same key on any device (D9). In an embedded world the chain and the key
 * die together - a browser that has lost its storage has not lost access to a
 * world, it has lost the world - so there is nothing to recover TO. The whole
 * recovery family is inapplicable here rather than merely unused.
 */

/**
 * ONE CAST, AND IT IS THE ONLY ONE IN THIS FOLDER.
 *
 * `initBurnerWallet` types `nodeURL` as a `string`, and a chain in the tab has
 * no URL. The implementation already copes: it builds its RPC with
 * `createCurriedJSONRPC(nodeURL)`, and `remote-procedure-call` accepts either a
 * URL string or anything with `.request({method, params})`, calling it per
 * request. MEASURED against a webevm node, 2026-09-19: the burner answers
 * `eth_requestAccounts`, `eth_chainId` (the minted id, round-tripped through
 * hex) and `eth_getBalance`.
 *
 * So this is a type that has not caught up with its own implementation, in a
 * package this project owns, and the fix is to widen `nodeURL` to
 * `string | EIP1193Provider` upstream - one line, no behaviour. When that
 * lands, delete this function's cast and nothing else changes.
 */
function asNodeURL(provider: EIP1193ProviderLike): string {
	return provider as unknown as string;
}

export type EmbeddedWallet = {
	/** The accounts it holds, first one selected. */
	accounts: `0x${string}`[];
	cleanup: () => void;
};

/**
 * Announce a wallet bound to the chain in the tab.
 *
 * `storagePrefix` is namespaced by the world's chain id rather than shared,
 * for the same reason the connection is: two worlds are two chains, and a
 * mnemonic that wandered between them would make one world's history appear in
 * another's account picker.
 */
export async function announceEmbeddedWallet(params: {
	provider: EIP1193ProviderLike;
	chainId: number;
	name?: string;
}): Promise<EmbeddedWallet> {
	const {provider, chainId} = params;

	const {
		provider: walletProvider,
		walletManager,
		cleanup,
	} = initBurnerWallet({
		nodeURL: asNodeURL(provider),
		storagePrefix: `embedded-wallet:${chainId}:`,
		// Its own identity in the picker. Without these it announces as "Burner
		// Wallet", which is what the app's own dev burner is already called, and
		// the player would be choosing between two entries with one name that
		// point at two different chains.
		name: params.name ?? 'Offline Wallet',
		rdns: 'dev.etherkit.burner.embedded',
		uuid: `embedded-${chainId}`,
	});

	// A fresh browser has no mnemonic, and a wallet with no accounts cannot be
	// chosen. `get()` first so a returning player keeps the accounts their
	// saved chain knows about.
	if (!walletManager.get().mnemonic) {
		walletManager.createNew();
	}

	// ASKED OF THE WALLET, NOT OF THE CHAIN, which is the distinction this whole
	// file is about: the node answers `eth_accounts` with a real -32601, and the
	// wallet in front of it is what has accounts at all.
	const accounts = (await walletProvider.request({
		method: 'eth_requestAccounts',
	})) as `0x${string}`[];

	return {accounts, cleanup};
}
