/**
 * Which account a wallet currently has selected, as opposed to which one the
 * app is connected as.
 *
 * THE TWO ARE NOT THE SAME, and treating them as one is what breaks against
 * wallets that expose a single account at a time. Rabby is the worked example:
 * `eth_accounts` returns exactly one address, and switching account in its UI
 * replaces it. @etherplay/connect deliberately does NOT follow that switch (for
 * the app's own connection an account change is an identity change), so the
 * connection can name account A while the wallet will only act as B.
 *
 * Everything that ASKS THE WALLET TO DO SOMETHING as a specific address has to
 * check this first: a `personal_sign` for A while the wallet holds B comes back
 * signed by B (or refused), and a transaction from A is simply refused. Both
 * failures arrive as an opaque wallet error, long after the user could have
 * been told to switch back.
 */

/** The shape both connections expose; deliberately structural. */
type WalletBearing = {
	wallet?: {
		accounts?: readonly `0x${string}`[];
		accountChanged?: `0x${string}`;
	};
};

/** Case-insensitive address comparison; the chain does not care about casing. */
const same = (a: string | undefined, b: string | undefined) =>
	!!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The accounts the wallet is offering right now.
 *
 * `accounts` IS THE ANSWER, because it is whatever `eth_accounts` last
 * returned, which is the wallet's own statement of what it will act as. The two
 * wallet shapes differ only in what that list contains: MetaMask returns every
 * account the user has connected, Rabby returns the one it currently exposes.
 *
 * `accountChanged` is deliberately NOT used to narrow it. It means "the active
 * account moved", not "the others are gone" - the library sets it alongside a
 * fresh `accounts` list on the same event. Reading it as the whole list made
 * MetaMask look like a one-account wallet the moment the user switched their
 * active account, and demanded a switch back that was never needed.
 */
export function walletAccountsNow(
	$connection: unknown,
): readonly `0x${string}`[] {
	const wallet = ($connection as WalletBearing | undefined)?.wallet;
	return wallet?.accounts ?? [];
}

/**
 * Whether the wallet can currently act as `address`.
 *
 * True when there is no wallet at all, deliberately: "can this wallet act as
 * X" is not a question about an account that has no wallet, and answering
 * false would make callers guard a case that is already handled elsewhere (an
 * account with no wallet never reaches a signature request).
 */
export function walletCanActAs(
	$connection: unknown,
	address: `0x${string}` | undefined,
): boolean {
	if (!address) return false;
	const accounts = walletAccountsNow($connection);
	if (accounts.length === 0) return true;
	return accounts.some((account) => same(account, address));
}

/**
 * The account the wallet has selected instead, when it cannot act as `address`.
 *
 * For telling the user what to switch back FROM, which is the difference
 * between "switch account" and a message they can act on without guessing.
 *
 * `accountChanged` first here, and only here: this is the one question it
 * actually answers, which is which account the wallet is now ON.
 */
export function walletSelectedInstead(
	$connection: unknown,
	address: `0x${string}` | undefined,
): `0x${string}` | undefined {
	if (walletCanActAs($connection, address)) return undefined;
	const wallet = ($connection as WalletBearing | undefined)?.wallet;
	return wallet?.accountChanged ?? walletAccountsNow($connection)[0];
}
