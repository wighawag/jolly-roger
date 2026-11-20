/**
 * Where an address or a transaction links to: the app's own explorer
 * (`/explorer/`), the chain's block explorer, both, or nowhere.
 *
 * Pure functions of a chain and a flag: nothing here reads the environment or
 * the deployments, so `core/ui/ethereum/` copies into any app. The app composes
 * its `BlockExplorer` (jolly-roger in `$lib/index.ts`) and provides it as a
 * capability (`provideBlockExplorer`); a component rendered with none provided
 * resolves `linkTo="auto"` to no link.
 */

/**
 * Link destination options for address/transaction components
 */
export type LinkToOption = 'internal' | 'external' | 'both' | 'auto' | false;

/** A `LinkToOption` with `auto` resolved. */
export type ResolvedLinkTo = 'internal' | 'external' | 'both' | false;

/** What a chain says about its block explorer (viem's and rocketh's shape). */
export type ExplorerChainInfo = {
	blockExplorers?: {default?: {name?: string; url?: string}};
};

/** The links an app offers for addresses and transactions. */
export type BlockExplorer = {
	/** Whether the app serves its own explorer at `/explorer/`. */
	internal(): boolean;
	/** Whether the chain names a block explorer (read at call time). */
	external(): boolean;
	/** The block explorer's page for a transaction, or null without one. */
	txUrl(hash: string): string | null;
	/** The block explorer's page for an address, or null without one. */
	addressUrl(address: string): string | null;
	/** The block explorer's name, or null without one. */
	name(): string | null;
};

/**
 * A `BlockExplorer` for a chain. `chain` and `internal` are read at every call
 * rather than once, so a chain that changes (HMR, a store that moves) is
 * followed, and creating one at module scope reads no configuration yet.
 */
export function createBlockExplorer(options: {
	chain: () => ExplorerChainInfo;
	internal: () => boolean;
}): BlockExplorer {
	const {chain, internal} = options;
	const baseUrl = () => chain().blockExplorers?.default?.url || null;
	return {
		internal,
		external() {
			return baseUrl() !== null;
		},
		txUrl(hash) {
			const url = baseUrl();
			return url ? `${url}/tx/${hash}` : null;
		},
		addressUrl(address) {
			const url = baseUrl();
			return url ? `${url}/address/${address}` : null;
		},
		name() {
			return chain().blockExplorers?.default?.name ?? null;
		},
	};
}

/**
 * Resolve a `linkTo` option. `auto` becomes what the explorer offers:
 * - internal and external: 'both'
 * - only internal: 'internal'
 * - only external: 'external'
 * - neither, or no explorer at all: false
 *
 * An explicit choice is returned as it is.
 */
export function resolveLinkTo(
	linkTo: LinkToOption,
	explorer?: BlockExplorer,
): ResolvedLinkTo {
	if (linkTo !== 'auto') return linkTo;
	if (!explorer) return false;
	const hasInternal = explorer.internal();
	const hasExternal = explorer.external();
	if (hasInternal && hasExternal) return 'both';
	if (hasInternal) return 'internal';
	if (hasExternal) return 'external';
	return false;
}
