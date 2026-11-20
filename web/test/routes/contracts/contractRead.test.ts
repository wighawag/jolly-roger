import {describe, it, expect} from 'vitest';
import type {AbiFunction, PublicClient} from 'viem';
import {readContractValue} from '../../../src/routes/contracts/lib/contractRead';
import {readContractValue as reExported} from '../../../src/routes/contracts/lib/contractCall';

const balanceOf = {
	type: 'function',
	name: 'balanceOf',
	stateMutability: 'view',
	inputs: [
		{type: 'address', name: 'owner'},
		{type: 'uint256', name: 'id'},
	],
	outputs: [{type: 'uint256', name: ''}],
} as const satisfies AbiFunction;

const OWNER = '0x1234567890abcdef1234567890abcdef12345678';
const CONTRACT = '0xabcdef0000000000000000000000000000009999';

function stubClient() {
	const calls: unknown[] = [];
	const client = {
		readContract: async (request: unknown) => {
			calls.push(request);
			return 42n;
		},
	} as unknown as PublicClient;
	return {client, calls};
}

describe('readContractValue', () => {
	it('converts the raw inputs and reads through the given client', async () => {
		const {client, calls} = stubClient();

		const value = await readContractValue({
			publicClient: client,
			abiItem: balanceOf,
			contractAddress: CONTRACT,
			inputValues: {owner: OWNER, id: '7'},
		});

		expect(value).toBe(42n);
		expect(calls).toEqual([
			{
				address: CONTRACT,
				abi: [balanceOf],
				functionName: 'balanceOf',
				args: [OWNER, 7n],
			},
		]);
	});

	it('throws without a client', async () => {
		await expect(
			readContractValue({
				publicClient: undefined as unknown as PublicClient,
				abiItem: balanceOf,
				contractAddress: CONTRACT,
				inputValues: {},
			}),
		).rejects.toThrow('Public client not available');
	});

	it('is the one contractCall.ts re-exports', () => {
		expect(reExported).toBe(readContractValue);
	});
});
