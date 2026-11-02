import {
	initBurnerWallet,
	BURNER_WALLET_ICON_DATA_URI,
} from '@etherkit/burner-wallet';
import {
	EthereumWalletProvider,
	type UnderlyingEthereumProvider,
} from '@etherplay/wallet-connector-ethereum';
import type {WalletHandle} from '@etherplay/wallet-connector';
import {mnemonicToAccount} from 'viem/accounts';
import type {EIP1193ProviderLike} from './types.js';

/**
 * WHO SIGNS IN AN EMBEDDED WORLD, and why it is a burner rather than the local
 * signer this tree spent a phase on.
 *
 * webevm holds no keys - `eth_accounts`, `eth_sendTransaction` and `eth_sign`
 * are a real `-32601` - so a world needs a wallet of its own, and the burner
 * is exactly one: a mnemonic in localStorage which signs locally and sends
 * `eth_sendRawTransaction`.
 *
 * THE LOCAL SIGNER WOULD BUY NOTHING HERE, which is worth stating because it
 * is upstream and it would be the obvious reach. Its value is that it is
 * RECOVERABLE: derived from a wallet signature, so the same account re-derives
 * the same key on any device (D9). In an embedded world the chain and the key
 * die together - a browser that has lost its storage has not lost access to a
 * world, it has lost the world - so there is nothing to recover TO. The whole
 * recovery family is inapplicable here rather than merely unused.
 *
 * THIS FILE USED TO HOLD THREE WRAPPERS AND NOW HOLDS NONE, which is the
 * better record of what they were. A cast made `nodeURL` accept the in-tab
 * node, a Proxy hid nine of the burner's ten accounts, and a connector
 * subclass replaced the wallet list. Each was a type that had not caught up
 * with its own implementation, in a library this project owns, and each is now
 * an option: `nodeURL` takes a provider, `accountCount` bounds the derivation,
 * and `createConnection` takes `wallets` directly. A wrapper that survives is
 * indistinguishable from a decision, so it is worth saying that these were
 * neither.
 */

export type EmbeddedWallet = {
	/**
	 * The accounts it holds, IN DERIVATION ORDER: index 0 of the mnemonic first,
	 * whichever one is selected. One unless several were asked for.
	 *
	 * Not the order the wallet reports, which puts the SELECTED account first
	 * (EIP-1193's "accounts[0] is the active one") and persists the selection,
	 * so after a reload on a later account the reported list starts with it. A
	 * world that funds and stakes "the player at index 0" must not get a
	 * different player depending on who was playing when the tab closed.
	 */
	accounts: `0x${string}`[];
	/**
	 * MAKE ONE OF ITS ACCOUNTS THE ACTIVE ONE, for a world with several people
	 * at one device (hotseat). The wallet reorders its accounts and announces
	 * the change (`accountsChanged`), which a connection built with
	 * `useCurrentAccount: 'always'` follows by reconnecting as that account, as
	 * an online connection follows a player switching account in their wallet.
	 * Throws for an address this wallet does not hold.
	 */
	select: (address: `0x${string}`) => void;
	/**
	 * THE WALLET THIS WORLD HAS, as the only one it has.
	 *
	 * Handed to `createConnection` as its entire wallet list, so the
	 * connection's universe is exactly this one instead of whatever the page
	 * happens to be announcing. That is what stops the player being ASKED: an
	 * offline world did not inherit the player's wallet choice, it made one for
	 * them, and every other wallet they own has no account on this chain.
	 */
	handle: WalletHandle<UnderlyingEthereumProvider>;
	cleanup: () => void;
};

/**
 * Build (and announce) a wallet bound to the chain in the tab.
 *
 * IT IS STILL ANNOUNCED over EIP-6963, even though the world's connection is
 * handed the handle directly and never looks at the announcements. Two small
 * reasons: a player who opens the app's ordinary wallet picker should be able
 * to SEE the thing their offline game is using rather than wonder what signed,
 * and the announcement is what makes the wallet reachable from a console or a
 * test without holding the world object.
 *
 * Note what the announcement cannot carry: EIP-6963's `info` is a standard
 * shape, so `autoApproves` is not in it. Only the handle below can declare it,
 * which is the library's own reasoning arriving from the other side - a wallet
 * can honestly claim never to prompt only when it was CONSTRUCTED rather than
 * discovered.
 */
export async function announceEmbeddedWallet(params: {
	provider: EIP1193ProviderLike;
	chainId: number;
	name?: string;
	/**
	 * How many accounts to derive: one per person playing at this device. 1
	 * when omitted, for the reason at `accountCount` below; several are for a
	 * world that switches between them itself (`select`), with a connection
	 * that follows the selection rather than asking (`useCurrentAccount`).
	 */
	accounts?: number;
}): Promise<EmbeddedWallet> {
	const {provider, chainId} = params;
	const accountCount = params.accounts ?? 1;
	const name = params.name ?? 'Offline Wallet';

	const {
		provider: walletProvider,
		walletManager,
		cleanup,
	} = initBurnerWallet({
		// An object rather than a URL: there is no URL for a chain that lives in
		// this tab. Supported since 0.1.0.
		nodeURL: provider,
		// ONE ACCOUNT, because ten is a question nobody asked. A wallet offering
		// several makes the connection show an account picker, which is a second
		// dialog between a player and a game they have already chosen to play.
		// A bound on derivation rather than a filter: the others are never
		// derived, so nothing downstream can reveal them. Several only when the
		// caller has several people to seat, and then the world's connection
		// follows the selected one instead of asking (`useCurrentAccount`).
		accountCount,
		storagePrefix: `embedded-wallet:${chainId}:`,
		// Its own identity in the picker. Without these it announces as "Burner
		// Wallet", which is what the app's own dev burner is already called, and
		// the player would be choosing between two entries with one name that
		// point at two different chains.
		name,
		rdns: 'dev.etherkit.burner.embedded',
		uuid: `embedded-${chainId}`,
	});

	// A fresh browser has no mnemonic, and a wallet with no accounts cannot be
	// chosen. `get()` first so a returning player keeps the account their saved
	// chain knows about.
	if (!walletManager.get().mnemonic) {
		walletManager.createNew();
	}

	// ASKED OF THE WALLET, NOT OF THE CHAIN, which is the distinction this whole
	// file is about: the node answers `eth_accounts` with a real -32601, and the
	// wallet in front of it is what has accounts at all.
	const reported = (await walletProvider.request({
		method: 'eth_requestAccounts',
	})) as `0x${string}`[];

	// Back into derivation order (see `EmbeddedWallet.accounts`). The path is
	// the burner's own (`m/44'/60'/0'/0/{index}`, its `derivation.ts`), which is
	// viem's default for an address index, and every reported account must be
	// found: a mismatch would mean funding addresses this wallet never uses.
	const mnemonic = walletManager.get().mnemonic;
	const accounts =
		reported.length <= 1 || !mnemonic
			? reported
			: Array.from({length: reported.length}, (_, addressIndex) => {
					const address = mnemonicToAccount(mnemonic, {addressIndex}).address;
					const found = reported.find(
						(a) => a.toLowerCase() === address.toLowerCase(),
					);
					if (!found) {
						throw new Error(
							`the embedded wallet does not hold the account at index ${addressIndex}`,
						);
					}
					return found;
				});

	const handle: WalletHandle<UnderlyingEthereumProvider> = {
		// The burner's provider ITSELF, not a `{request}` object around it:
		// `EthereumWalletProvider` also calls `on` and `removeListener` to follow
		// account and chain changes, and a wrapper forwarding only `request`
		// throws from inside the connection, as a failed transaction, with the
		// send already signed. That is measured rather than feared, and the
		// package's own type now says so at the field.
		walletProvider: new EthereumWalletProvider(walletProvider),
		info: {
			uuid: `embedded-${chainId}`,
			name,
			icon: BURNER_WALLET_ICON_DATA_URI,
			rdns: 'dev.etherkit.burner.embedded',
			// THE DECLARATION, and the reason this world needs no wallet UI: it
			// holds the key, it answers by itself, and it puts nothing on screen
			// to wait for. `@etherplay/connect` acts on it by not announcing a
			// pending request, so an app's "confirm this in your wallet" surfaces
			// never fire for it - without every app having to infer it.
			autoApproves: true,
		},
	};

	const select = (address: `0x${string}`) => {
		const held = accounts.find(
			(a) => a.toLowerCase() === address.toLowerCase(),
		);
		if (!held) {
			throw new Error(`the embedded wallet does not hold ${address}`);
		}
		walletManager.selectAccount(held);
	};

	return {accounts, select, handle, cleanup};
}
