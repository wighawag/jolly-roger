/**
 * WHICH CHAIN ID AN EMBEDDED WORLD RUNS UNDER, and why it is minted rather
 * than fixed.
 *
 * An embedded chain's id is an OPTION rather than a discovery: nothing hands
 * it to you, so the app decides. The temptation is to say 31337 and move on,
 * and that is the one answer that breaks something: everything a player keeps
 * is keyed by the chain they kept it on, so two embedded worlds sharing an id
 * collide under a byte-identical key. The operations ledger keys by
 * `${chainId}_${genesisHash}_${scope}` and a game's own submission storage by
 * `${chainId}_${gameAddress}_${player}`, and the genesis hash does NOT save the
 * second one: genesis is the block BEFORE any transaction, so two worlds seeded
 * by the same script have the same genesis and the same hash. It discriminates
 * CONFIGURATIONS, not instances.
 *
 * Minting a distinct id per world fixes it with no schema, no index and no
 * migration, and it is the correct shape rather than the cheap one: two
 * different chains SHOULD NOT share an id (that is what EIP-155 means), and it
 * domain-separates every signature derived from the chain id for free.
 *
 * THE RANGE IS THE ONLY DECISION HERE, and it is made against two measurements
 * rather than a feeling.
 *
 * - EIP-2294 proposes `2^53 - 3` (9,007,199,254,740,989) as the maximum chain
 *   id, so that an id always survives a round trip through a JSON number. Above
 *   it, `JSON.parse` silently rounds and two worlds could end up the same. So
 *   that is the ceiling.
 * - The highest id anyone has actually registered is 2,716,446,429,837,001
 *   (chainid.network, 2,763 chains, read 2026-09-19), which is three orders of
 *   magnitude below that ceiling. So the top of the permitted range is empty
 *   and is very unlikely to be allocated: registering an id up there costs its
 *   owner the same JSON hazard EIP-2294 is about.
 *
 * Hence the top 2^20 ids below the EIP-2294 ceiling. 1,048,576 of them, all
 * clear of every real network and of both dev conventions (1337, 31337), which
 * matters because colliding with a chain the player's wallet already knows is
 * worse than the problem being solved.
 */

/** EIP-2294's proposed maximum: `2^53 - 3`. */
export const MAX_CHAIN_ID = 9007199254740989;

/** The lowest id an embedded world mints. */
export const MIN_EMBEDDED_CHAIN_ID = MAX_CHAIN_ID - 0x100000; // 2^20 ids

/** The highest id an embedded world mints. */
export const MAX_EMBEDDED_CHAIN_ID = MAX_CHAIN_ID;

/** Is this id one an embedded world minted? */
export function isEmbeddedChainId(id: number): boolean {
	return (
		Number.isInteger(id) &&
		id >= MIN_EMBEDDED_CHAIN_ID &&
		id <= MAX_EMBEDDED_CHAIN_ID
	);
}

/**
 * Mint an id for a new world.
 *
 * @param random Injected so a test can pin the result, and so nothing here
 * depends on a global. Must return `[0, 1)`, as `Math.random` does.
 */
export function mintChainId(random: () => number = Math.random): number {
	const span = MAX_EMBEDDED_CHAIN_ID - MIN_EMBEDDED_CHAIN_ID + 1;
	const offset = Math.floor(random() * span);
	// A `random()` of exactly 1 is out of contract but costs nothing to survive,
	// and an id above the ceiling is the one failure this file exists to prevent.
	return MIN_EMBEDDED_CHAIN_ID + Math.min(offset, span - 1);
}

/**
 * The id of the world stored under `key`, minting and remembering one the first
 * time.
 *
 * THE ID IS THE ONE THING A WORLD MUST PERSIST ITSELF. The chain state persists
 * through webevm's own dump, and the deployment records through
 * `@rocketh/web`'s store; neither of them holds the id, and a world that minted
 * a fresh one on every load would orphan its own player's submissions on every
 * reload. Storage is passed in rather than reached for, so this is the same
 * function in a test, in a server render (where there is none) and in a tab.
 */
export function rememberChainId(params: {
	storage: {
		getItem(key: string): string | null;
		setItem(key: string, value: string): void;
	};
	key: string;
	random?: () => number;
}): number {
	const {storage, key, random} = params;
	const stored = storage.getItem(key);
	if (stored !== null) {
		const parsed = Number(stored);
		// A stored id that is not one we could have minted is not repaired, it is
		// replaced: it is either corrupt or from a build with a different range,
		// and carrying it forward would key a world by something this code cannot
		// reason about. Replacing it starts a new world, which is what a browser
		// that has lost its storage has already done.
		if (isEmbeddedChainId(parsed)) {
			return parsed;
		}
	}
	const minted = mintChainId(random);
	storage.setItem(key, String(minted));
	return minted;
}
