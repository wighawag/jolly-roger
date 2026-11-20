// The explorer's decoding and scanning take their contracts and their chain as
// parameters: nothing here mocks `$lib/deployments-store`, so these modules
// import without jolly-roger's generated deployments (the rocketh playground
// copies them as they are).
import {describe, it, expect, vi, afterEach} from 'vitest';
import {
	encodeEventTopics,
	encodeFunctionData,
	encodeAbiParameters,
	type Log,
	type PublicClient,
	type Transaction,
	type TransactionReceipt,
} from 'viem';
import {decodeTransaction} from '../../../src/routes/explorer/lib/services/transactionDecoder';
import {loadTransactionItemData} from '../../../src/routes/explorer/lib/services/transactionItem';
import {
	decodeLogs,
	findContractByAddress,
	type DecodingContracts,
} from '../../../src/routes/explorer/lib/utils';
import {scanLatestTransactions} from '../../../src/routes/explorer/lib/services/blockScanner';

const counterAbi = [
	{
		type: 'function',
		name: 'incBy',
		stateMutability: 'nonpayable',
		inputs: [{type: 'uint256', name: 'by'}],
		outputs: [],
	},
	{
		type: 'event',
		name: 'Increment',
		inputs: [{type: 'uint256', name: 'by', indexed: false}],
	},
] as const;

const COUNTER = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const SENDER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

const contracts: DecodingContracts = {
	Counter: {address: COUNTER, abi: counterAbi},
};

function tx(overrides: Partial<Transaction> = {}): Transaction {
	return {
		hash: '0x01',
		from: SENDER,
		to: COUNTER,
		input: encodeFunctionData({
			abi: counterAbi,
			functionName: 'incBy',
			args: [5n],
		}),
		value: 0n,
		blockNumber: 1n,
		type: 'eip1559',
		...overrides,
	} as Transaction;
}

const receipt = {
	status: 'success',
	blockNumber: 1n,
	logs: [],
} as unknown as TransactionReceipt;

const unusedClient = {} as PublicClient;

describe('decodeTransaction with its contracts as a parameter', () => {
	it('decodes a call to a contract of the map', async () => {
		const decoded = await decodeTransaction(
			tx(),
			receipt,
			unusedClient,
			contracts,
		);
		expect(decoded).toMatchObject({
			isDecoded: true,
			contractName: 'Counter',
			functionName: 'incBy',
			status: 'success',
		});
	});

	it('does not decode a call to an address the map does not know', async () => {
		const decoded = await decodeTransaction(tx(), receipt, unusedClient, {});
		expect(decoded.isDecoded).toBe(false);
		expect(decoded.contractName).toBeUndefined();
	});

	it('is what loadTransactionItemData passes the contracts to', async () => {
		const client = {
			getTransactionReceipt: async () => receipt,
		} as unknown as PublicClient;
		const {decodedData} = await loadTransactionItemData(
			tx(),
			client,
			contracts,
		);
		expect(decodedData.functionName).toBe('incBy');
	});
});

describe('decodeLogs and findContractByAddress with the contracts as a parameter', () => {
	it('finds a contract by address, case-insensitively', () => {
		expect(
			findContractByAddress(
				COUNTER.toUpperCase().replace('0X', '0x') as `0x${string}`,
				contracts,
			)?.name,
		).toBe('Counter');
		expect(findContractByAddress(SENDER, contracts)).toBeNull();
	});

	it("decodes a log of a contract of the map, and skips another's", () => {
		const log = {
			address: COUNTER,
			topics: encodeEventTopics({abi: counterAbi, eventName: 'Increment'}),
			data: encodeAbiParameters([{type: 'uint256'}], [5n]),
			blockNumber: 1n,
			transactionHash: '0x01',
		} as unknown as Log;
		const events = decodeLogs(
			[log, {...log, address: SENDER} as Log],
			contracts,
		);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({eventName: 'Increment', address: COUNTER});
	});
});

describe('scanLatestTransactions with the block index', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps the index under the client's chain", async () => {
		const storage = new Map<string, string>();
		vi.stubGlobal('window', {});
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key),
		});
		const block = {
			number: 3n,
			timestamp: 1000n,
			transactions: [tx({blockNumber: 3n})],
		};
		const client = {
			chain: {id: 7},
			getBlockNumber: async () => 3n,
			getBlock: async () => block,
		} as unknown as PublicClient;

		const txs = await scanLatestTransactions(client, 1, 1, 1, true);

		expect(txs).toHaveLength(1);
		const keys = [...storage.keys()];
		expect(keys.length).toBeGreaterThan(0);
		expect(keys.every((key) => /:7(:|$)/.test(key))).toBe(true);
	});

	it('asks the client for its chain id when it carries no chain', async () => {
		const storage = new Map<string, string>();
		vi.stubGlobal('window', {});
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key),
		});
		const client = {
			getChainId: async () => 11,
			getBlockNumber: async () => 3n,
			getBlock: async () => ({
				number: 3n,
				timestamp: 1000n,
				transactions: [tx({blockNumber: 3n})],
			}),
		} as unknown as PublicClient;

		await scanLatestTransactions(client, 1, 1, 1, true);

		const keys = [...storage.keys()];
		expect(keys.length).toBeGreaterThan(0);
		expect(keys.every((key) => /:11(:|$)/.test(key))).toBe(true);
	});
});
