/**
 * The transactions a deploy sent, as a LAN box can replay them: CREATE2
 * deployments through the deterministic-deployment proxy, and GUARDED setup
 * calls (see ./record.ts), or an error naming the transaction that is neither.
 *
 * Used by `scripts/deploy-lan-build.ts`, which builds the LAN package, and by
 * `test/js/DeterministicDeploys.test.ts`, so a deploy script that would break
 * the LAN package fails the contract tests first, at the level that wrote it,
 * instead of in a Nix build somewhere below.
 *
 * WHY THE FACTORY. A LAN box (github:wighawag/ethereum-lan-node) runs its
 * own chain, and its faucet pays from account 0, which is also the deployer. A
 * nonce-based address therefore depends on how many claims the faucet served
 * before the deploy ran, and the web app, built with the addresses beforehand,
 * would point at nothing. A CREATE2 address depends only on the salt and the
 * init code.
 *
 * A SETUP CALL (one contract told about another, a role granted) is replayed
 * too, but only when the deploy script guarded it (`execute(..., {guard})`):
 * the box reads the guard and sends the call only when its effect is missing,
 * so running the deploy on every boot never repeats it. An unguarded call is
 * refused, since the box could not tell whether it already happened.
 */
import type {Check, Recorded} from './record.js';
/** What this needs of a provider (hardhat's, or any EIP-1193 one). */
type Provider = {
	request(args: {method: string; params?: unknown[]}): Promise<unknown>;
};

/** The deterministic-deployment proxy (github:Arachnid/deterministic-deployment-proxy). */
export const FACTORY = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
/** The account that sends the factory's own pre-signed deployment. */
export const FACTORY_DEPLOYER = '0x3fab184622dc19b6109349b94811493bf2a45362';

export type ReplayableTransaction =
	| {
			/** absent: a CREATE2 deployment (the only kind there used to be) */
			kind?: undefined;
			/** index of the sender among `accounts` (on a box: in the test mnemonic) */
			account: number;
			/** the address the init code lands at */
			address: string;
			/** salt (32 bytes) ++ init code, sent to the factory as is */
			data: string;
	  }
	| {
			kind: 'call';
			account: number;
			to: string;
			data: string;
			/** wei, as a decimal string */
			value: string;
			/** what tells the box it has already taken effect */
			check: Check;
	  };

type Tx = {
	hash: string;
	from: string;
	to: string | null;
	input: string;
	value: string;
};

/**
 * Read every block of an in-process chain the deploy ran on (from block 1),
 * and return its transactions as a box would replay them.
 *
 * @param accounts the senders a box can sign for, in mnemonic order (the
 * deployer first): a transaction from anyone else is refused.
 * @param deployments the records the deploy wrote, by name: each must be one
 * of the replayed addresses, or the web app would be built against a
 * contract the box never gets.
 * @param recorded the guarded calls the deploy sent (./record.ts).
 */
export async function replayableTransactions(
	provider: Provider,
	accounts: readonly string[],
	deployments: Record<string, {address: string}>,
	recorded: Recorded = new Map(),
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
			const check = recorded.get(tx.hash.toLowerCase());
			if (account >= 0 && to !== null && to !== FACTORY && check) {
				transactions.push({
					kind: 'call',
					account,
					to,
					data: tx.input,
					value: BigInt(tx.value).toString(),
					check,
				});
				continue;
			}
			if (account < 0 || to !== FACTORY || BigInt(tx.value) !== 0n) {
				throw new Error(
					`block ${n} has a transaction a LAN box could not replay ` +
						`(from ${tx.from} to ${tx.to}): every contract must be deployed with ` +
						'`deterministic: true`, and every other transaction must be an `execute` ' +
						'with a `guard`, so a box can tell whether it already happened' +
						(account < 0
							? ` (and be sent by one of the first ${senders.length} accounts of the mnemonic)`
							: ''),
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
	const replayed = new Set(
		transactions.flatMap((t) =>
			t.kind === 'call' ? [] : [t.address.toLowerCase()],
		),
	);
	for (const [name, d] of Object.entries(deployments)) {
		if (!replayed.has(d.address.toLowerCase()))
			throw new Error(
				`${name} at ${d.address} was not deployed through the factory ${FACTORY}`,
			);
	}
	return transactions;
}
