/**
 * The transactions a deploy sent, as a LAN box can replay them: every one a
 * CREATE2 deployment through the deterministic-deployment proxy, or an error
 * naming the one that is not.
 *
 * Used by `scripts/deploy-lan-build.ts`, which builds the LAN package, and by
 * `test/js/DeterministicDeploys.test.ts`, so a deploy script that would break
 * the LAN package fails the contract tests first, at the level that wrote it,
 * instead of in a Nix build somewhere below.
 *
 * WHY ONLY THE FACTORY. A LAN box (github:wighawag/ethereum-lan-node) runs its
 * own chain, and its faucet pays from account 0, which is also the deployer. A
 * nonce-based address therefore depends on how many claims the faucet served
 * before the deploy ran, and the web app, built with the addresses beforehand,
 * would point at nothing. A CREATE2 address depends only on the salt and the
 * init code. The same goes for any transaction that is not a deployment (a
 * setup call after the deploy): its effect is not in any init code, so a
 * replay of the deployments alone would not reproduce it.
 */
/** What this needs of a provider (hardhat's, or any EIP-1193 one). */
type Provider = {
	request(args: {method: string; params?: unknown[]}): Promise<unknown>;
};

/** The deterministic-deployment proxy (github:Arachnid/deterministic-deployment-proxy). */
export const FACTORY = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
/** The account that sends the factory's own pre-signed deployment. */
export const FACTORY_DEPLOYER = '0x3fab184622dc19b6109349b94811493bf2a45362';

export type ReplayableTransaction = {
	/** index of the sender among `accounts` (on a box: in the test mnemonic) */
	account: number;
	/** the address the init code lands at */
	address: string;
	/** salt (32 bytes) ++ init code, sent to the factory as is */
	data: string;
};

type Tx = {from: string; to: string | null; input: string; value: string};

/**
 * Read every block of an in-process chain the deploy ran on (from block 1),
 * and return its transactions as a box would replay them.
 *
 * @param accounts the senders a box can sign for, in mnemonic order (the
 * deployer first): a transaction from anyone else is refused.
 * @param deployments the records the deploy wrote, by name: each must be one
 * of the replayed addresses, or the web app would be built against a
 * contract the box never gets.
 */
export async function replayableTransactions(
	provider: Provider,
	accounts: readonly string[],
	deployments: Record<string, {address: string}>,
): Promise<ReplayableTransaction[]> {
	const senders = accounts.map((a) => a.toLowerCase());
	const latest = Number(await provider.request({method: 'eth_blockNumber'}));
	const transactions: ReplayableTransaction[] = [];
	for (let n = 1; n <= latest; n++) {
		const block = (await provider.request({
			method: 'eth_getBlockByNumber',
			params: [`0x${n.toString(16)}`, true],
		})) as {transactions: Tx[]};
		for (const tx of block.transactions) {
			const from = tx.from.toLowerCase();
			const to = tx.to?.toLowerCase() ?? null;
			// The factory itself, and the ETH its pre-signed deployment needs: a
			// box's genesis predeploys it.
			if (from === FACTORY_DEPLOYER && to === null) continue;
			if (to === FACTORY_DEPLOYER && tx.input === '0x') continue;
			const account = senders.indexOf(from);
			if (account < 0 || to !== FACTORY || BigInt(tx.value) !== 0n) {
				throw new Error(
					`block ${n} has a transaction a LAN box could not replay deterministically ` +
						`(from ${tx.from} to ${tx.to}): every contract must be deployed with ` +
						'`deterministic: true`, and a deploy script may send nothing else',
				);
			}
			// What the factory deploys there: it returns the address it created.
			const address = (await provider.request({
				method: 'eth_call',
				params: [
					{from: tx.from, to: FACTORY, data: tx.input},
					`0x${(n - 1).toString(16)}`,
				],
			})) as string;
			transactions.push({
				account,
				address: `0x${address.slice(-40)}`,
				data: tx.input,
			});
		}
	}
	const replayed = new Set(transactions.map((t) => t.address.toLowerCase()));
	for (const [name, d] of Object.entries(deployments)) {
		if (!replayed.has(d.address.toLowerCase()))
			throw new Error(
				`${name} at ${d.address} was not deployed through the factory ${FACTORY}`,
			);
	}
	return transactions;
}
