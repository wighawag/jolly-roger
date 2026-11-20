// What the explorer shows for a transaction it decodes: a refused replay's
// reason (P1-8), an undecoded call's label (P1-9), and the call's arguments
// (P1-10). The existing cases of transactionDecoder.test.ts are kept as they
// were, as the oracle.
import {describe, it, expect} from 'vitest';
import {
	CallExecutionError,
	InvalidInputRpcError,
	RpcRequestError,
	encodeFunctionData,
	getAddress,
	type PublicClient,
	type Transaction,
	type TransactionReceipt,
} from 'viem';
import {
	decodeTransaction,
	formatDecodedArgs,
	formatDecodedTransaction,
} from '../../../src/routes/explorer/lib/services/transactionDecoder';
import type {DecodingContracts} from '../../../src/routes/explorer/lib/utils';

const counterAbi = [
	{
		type: 'function',
		name: 'incBy',
		stateMutability: 'nonpayable',
		inputs: [{type: 'uint256', name: 'by'}],
		outputs: [],
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

const failed = {
	status: 'reverted',
	blockNumber: 1n,
	logs: [],
} as unknown as TransactionReceipt;

describe('a replay the node refuses', () => {
	it("shows the node's explanation, not viem's generic text", async () => {
		const refusal = new CallExecutionError(
			new InvalidInputRpcError(
				new RpcRequestError({
					body: {method: 'eth_call'},
					error: {code: -32000, message: 'historical state not available'},
					url: 'http://localhost:8545',
				}),
			),
			{account: SENDER, to: COUNTER},
		);
		const client = {
			call: async () => {
				throw refusal;
			},
		} as unknown as PublicClient;

		const decoded = await decodeTransaction(tx(), failed, client, contracts);

		expect(decoded.error).toBe('historical state not available');
	});
});

describe('a transaction the explorer cannot decode', () => {
	const succeeded = {
		status: 'success',
		blockNumber: 1n,
		logs: [],
	} as unknown as TransactionReceipt;
	const unusedClient = {} as PublicClient;
	const unknownCall =
		'0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001';

	it('is a transfer when it carries no data', async () => {
		const decoded = await decodeTransaction(
			tx({input: '0x', value: 1n}),
			succeeded,
			unusedClient,
			contracts,
		);
		expect(decoded.selector).toBeUndefined();
		expect(formatDecodedTransaction(decoded)).toMatchObject({
			methodLabel: 'Transfer',
			methodDetails: undefined,
		});
	});

	it('is a call to an unknown contract when no contract has its address', async () => {
		const decoded = await decodeTransaction(
			tx({to: SENDER}),
			succeeded,
			unusedClient,
			contracts,
		);
		expect(decoded.selector).toBe('0x70119d06');
		expect(formatDecodedTransaction(decoded)).toMatchObject({
			methodLabel: 'Call to an unknown contract',
			methodDetails: '0x70119d06',
		});
	});

	it('is an unknown function of a known contract when its ABI does not decode it', async () => {
		const decoded = await decodeTransaction(
			tx({input: unknownCall}),
			succeeded,
			unusedClient,
			contracts,
		);
		expect(decoded).toMatchObject({
			isDecoded: false,
			contractName: 'Counter',
			selector: '0xdeadbeef',
		});
		expect(formatDecodedTransaction(decoded)).toMatchObject({
			methodLabel: 'Counter: unknown function',
			methodDetails: '0xdeadbeef',
		});
	});
});

describe("a decoded call's arguments", () => {
	const succeeded = {
		status: 'success',
		blockNumber: 1n,
		logs: [],
	} as unknown as TransactionReceipt;
	const unusedClient = {} as PublicClient;

	it('are named and typed, a number unquoted', async () => {
		const decoded = await decodeTransaction(
			tx(),
			succeeded,
			unusedClient,
			contracts,
		);
		expect(formatDecodedTransaction(decoded)).toMatchObject({
			methodLabel: 'Counter.incBy',
			methodDetails: '(by: 5)',
		});
	});

	it('are named from the overload the selector names', async () => {
		const overloaded = [
			{
				type: 'function',
				name: 'set',
				stateMutability: 'nonpayable',
				inputs: [{type: 'uint256', name: 'amount'}],
				outputs: [],
			},
			{
				type: 'function',
				name: 'set',
				stateMutability: 'nonpayable',
				inputs: [{type: 'address', name: 'owner'}],
				outputs: [],
			},
		] as const;
		const decoded = await decodeTransaction(
			tx({
				input: encodeFunctionData({
					abi: [overloaded[1]],
					functionName: 'set',
					args: [SENDER],
				}),
			}),
			succeeded,
			unusedClient,
			{Counter: {address: COUNTER, abi: overloaded}},
		);
		expect(formatDecodedTransaction(decoded).methodDetails).toBe(
			`(owner: ${getAddress(SENDER)})`,
		);
	});

	it('print a bool and an address bare, a string quoted, a tuple and an array as JSON', () => {
		const inputs = [
			{type: 'bool', name: 'flag'},
			{type: 'address', name: 'to'},
			{type: 'string', name: 'note'},
			{
				type: 'tuple',
				name: 'pair',
				components: [
					{type: 'uint256', name: 'a'},
					{type: 'uint256', name: 'b'},
				],
			},
			{type: 'uint256[]', name: 'ids'},
			{type: 'uint8', name: ''},
		] as const;
		expect(
			formatDecodedArgs(
				[true, SENDER, 'hi', {a: '1', b: '2'}, ['3', '4'], '9'],
				inputs,
			),
		).toBe(
			`(flag: true, to: ${SENDER}, note: "hi", pair: {"a":"1","b":"2"}, ids: ["3","4"], arg5: 9)`,
		);
	});
});
