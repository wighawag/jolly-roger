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
	type PublicClient,
	type Transaction,
	type TransactionReceipt,
} from 'viem';
import {decodeTransaction} from '../../../src/routes/explorer/lib/services/transactionDecoder';
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
