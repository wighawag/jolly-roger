// The headline the explorer lists a transaction under, in its list and on its
// page. Both views printed "Contract Call" themselves for every undecoded
// transaction with a recipient, a plain transfer included, instead of the
// decoder's label and selector (`formatDecodedTransaction`, P1-9): the label
// was right and its readers did not read it (K3-9).
import {describe, it, expect} from 'vitest';
import {
	encodeFunctionData,
	type PublicClient,
	type Transaction,
	type TransactionReceipt,
} from 'viem';
import {
	decodeTransaction,
	transactionHeadline,
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
const succeeded = {
	status: 'success',
	blockNumber: 1n,
	logs: [],
} as unknown as TransactionReceipt;
const unusedClient = {} as PublicClient;

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

const decode = (t: Transaction) =>
	decodeTransaction(t, succeeded, unusedClient, contracts);

describe('a decoded transaction', () => {
	it('is headed by its function and its arguments', async () => {
		const t = tx();
		expect(transactionHeadline(t, await decode(t))).toEqual({
			kind: 'function',
			label: 'Counter.incBy',
			details: '(by: 5)',
		});
	});

	it('is a transfer, not a contract call, when it carries no data', async () => {
		const t = tx({input: '0x', value: 1n});
		expect(transactionHeadline(t, await decode(t))).toEqual({
			kind: 'other',
			label: 'Transfer',
			details: undefined,
		});
	});

	it('names an unknown function by its contract and its selector', async () => {
		const t = tx({
			input:
				'0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001',
		});
		expect(transactionHeadline(t, await decode(t))).toEqual({
			kind: 'other',
			label: 'Counter: unknown function',
			details: '0xdeadbeef',
		});
	});

	it('names a call to an unknown contract with its selector', async () => {
		const t = tx({to: SENDER});
		expect(transactionHeadline(t, await decode(t))).toEqual({
			kind: 'other',
			label: 'Call to an unknown contract',
			details: '0x70119d06',
		});
	});

	it('is a contract creation when it has no recipient', async () => {
		const t = tx({to: null});
		expect(transactionHeadline(t, await decode(t))).toMatchObject({
			kind: 'creation',
			label: 'Contract Creation',
		});
	});
});

describe('a transaction not decoded yet', () => {
	it('is a contract call with its selector when it carries data', () => {
		expect(transactionHeadline(tx(), undefined)).toEqual({
			kind: 'other',
			label: 'Contract Call',
			details: '0x70119d06',
		});
	});

	it('is a transfer when it carries none', () => {
		expect(
			transactionHeadline(tx({input: '0x', value: 1n}), undefined),
		).toMatchObject({kind: 'other', label: 'Transfer'});
	});

	it('is a contract creation when it has no recipient', () => {
		expect(transactionHeadline(tx({to: null}), undefined)).toMatchObject({
			kind: 'creation',
			label: 'Contract Creation',
		});
	});
});
