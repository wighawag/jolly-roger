import {
	initBurnerWallet,
	BURNER_WALLET_ICON_DATA_URI,
} from '@etherkit/burner-wallet';
import {
	EthereumWalletConnector,
	EthereumWalletProvider,
	type UnderlyingEthereumProvider,
} from '@etherplay/wallet-connector-ethereum';
import type {WalletConnector, WalletHandle} from '@etherplay/wallet-connector';
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
	/**
	 * THE WALLET THIS WORLD HAS, as the only one it has.
	 *
	 * Handed to `createConnection` so the connection's universe of wallets is
	 * exactly this one, instead of whatever the page happens to be announcing.
	 * That is what stops the player being ASKED: an offline world did not
	 * inherit the player's wallet choice, it made one for them, so offering
	 * them MetaMask and the app's own dev burner beside it is offering two
	 * wrong answers and one right one.
	 */
	connector: WalletConnector<UnderlyingEthereumProvider>;
	cleanup: () => void;
};

/**
 * A connector whose entire world is one wallet.
 *
 * Everything except the wallet LIST is inherited, and that is the point:
 * `createAlwaysOnProvider` (the whole request-tracking provider wrapper) and
 * the account generator are the default connector's, so this cannot drift from
 * how the app talks to any other chain.
 */
class SoleWalletConnector extends EthereumWalletConnector {
	constructor(private readonly only: WalletHandle<UnderlyingEthereumProvider>) {
		super();
	}

	fetchWallets(
		walletAnnounced: (handle: WalletHandle<UnderlyingEthereumProvider>) => void,
	): void {
		walletAnnounced(this.only);
	}
}

/**
 * ONE ACCOUNT, because ten is a question nobody asked.
 *
 * The burner derives `ACCOUNT_COUNT` accounts from its mnemonic, and a wallet
 * offering several makes the connection show an account picker - the second
 * dialog between a player and a game they have already chosen to play. An
 * offline world has no reason to have more than one player on it, so the
 * provider handed to the connection reports the first and hides the rest.
 *
 * They still EXIST: the mnemonic is unchanged and a hotseat world, which is
 * the one thing that would want several, can announce them deliberately rather
 * than inheriting them by accident.
 */
function firstAccountOnly<T extends object>(provider: T): T {
	// A PROXY RATHER THAN A `{request}` OBJECT, and the difference is a bug
	// that only shows up at the second click. `EthereumWalletProvider` also
	// calls `on` and `removeListener` on whatever it is given, to follow
	// account and chain changes, and a wrapper that forwarded only `request`
	// therefore threw `removeListener is not a function` - from inside the
	// connection, as a failed transaction, with the send already signed.
	// Forwarding everything and intercepting one method is the shape that
	// cannot go stale when the interface grows.
	return new Proxy(provider, {
		get(target, prop, receiver) {
			if (prop === 'request') {
				return async (args: {method: string; params?: unknown}) => {
					const result = await (
						target as unknown as {
							request(a: {method: string; params?: unknown}): Promise<unknown>;
						}
					).request(args);
					if (
						args.method === 'eth_accounts' ||
						args.method === 'eth_requestAccounts'
					) {
						return (result as `0x${string}`[]).slice(0, 1);
					}
					return result;
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

/**
 * Build (and announce) a wallet bound to the chain in the tab.
 *
 * IT IS STILL ANNOUNCED over EIP-6963, even though the world's own connection
 * is handed the connector directly and never looks at the announcements. Two
 * reasons, both small: a player who opens the app's ordinary wallet picker
 * should be able to SEE the thing their offline game is using rather than
 * wonder what signed, and the announcement is what makes the wallet reachable
 * from a console or a test without holding the world object.
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
	const single = firstAccountOnly(
		walletProvider as object,
	) as EIP1193ProviderLike;
	const accounts = (await single.request({
		method: 'eth_requestAccounts',
	})) as `0x${string}`[];

	const connector = new SoleWalletConnector({
		walletProvider: new EthereumWalletProvider(
			single as never,
		) as unknown as WalletHandle<UnderlyingEthereumProvider>['walletProvider'],
		info: {
			uuid: `embedded-${chainId}`,
			name: params.name ?? 'Offline Wallet',
			icon: BURNER_WALLET_ICON_DATA_URI,
			rdns: 'dev.etherkit.burner.embedded',
		},
	});

	return {accounts, connector, cleanup};
}
