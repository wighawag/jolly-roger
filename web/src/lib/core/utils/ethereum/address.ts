/**
 * Comparing two addresses for "is this the same account".
 *
 * Always through this, never with `===`. The addresses this app compares arrive
 * from different places - a caller, an executor store, a wallet, a chain read,
 * a URL - and those places disagree about casing: EIP-55 checksums some of the
 * letters, an RPC answer is usually all lower case, and a hand-typed one is
 * whatever the user pasted. They are the same account either way, so a strict
 * compare reports "different account" for a difference that has no meaning.
 *
 * That is not hypothetical here. The faucet decides whether to unblock a waiting
 * transaction by comparing the account it funded against the account that is
 * short; a strict compare there silently skipped the notice and left a funded
 * user watching a modal wait for a change it had already been told about.
 *
 * `undefined` is never equal to anything, including another `undefined`. An
 * unknown account is not a match, it is an absence of one, and treating two
 * absences as agreement is how "no sender" ends up offered a remedy aimed at
 * whoever happens to be signed in.
 */
export function sameAddress(
	a: `0x${string}` | undefined,
	b: `0x${string}` | undefined,
): boolean {
	if (!a || !b) return false;
	return a.toLowerCase() === b.toLowerCase();
}
