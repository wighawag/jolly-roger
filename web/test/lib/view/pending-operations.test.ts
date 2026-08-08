import {describe, it, expect} from 'vitest';
import {applyPendingOperations} from '../../../src/lib/view/index';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import type {Message} from '../../../src/lib/onchain/state';

const owner = '0x1111111111111111111111111111111111111111' as const;
const signer = '0x2222222222222222222222222222222222222222' as const;
const other = '0x3333333333333333333333333333333333333333' as const;
const stranger = '0x4444444444444444444444444444444444444444' as const;

const message = (
	account: `0x${string}`,
	text: string,
	timestamp: number,
): Message => ({account, message: text, timestamp});

function operation(params: {
	from: `0x${string}`;
	functionName?: string;
	args?: unknown[];
	nonce?: number;
	broadcastTimestampMs?: number;
	inclusion?: string;
	status?: string;
}): OnchainOperation {
	const {
		from,
		functionName = 'setMessage',
		args = ['hello'],
		nonce = 1,
		broadcastTimestampMs = 1000,
		inclusion,
		status,
	} = params;
	return {
		metadata: {
			type: 'functionCall',
			functionName,
			args,
			tx: {from, nonce, broadcastTimestampMs},
		},
		transactionIntent: {
			state: inclusion || status ? {inclusion, status} : undefined,
		},
	} as unknown as OnchainOperation;
}

const apply = (params: {
	messages?: Message[];
	operations?: Record<string, OnchainOperation>;
	account?: `0x${string}`;
	maxMessages?: number;
}) =>
	applyPendingOperations({
		messages: params.messages ?? [],
		operations: params.operations ?? {},
		account: 'account' in params ? params.account : owner,
		maxMessages: params.maxMessages ?? 10,
	});

describe('applyPendingOperations', () => {
	it('passes the chain through untouched when nothing is pending', () => {
		const messages = [message(other, 'onchain', 500)];
		expect(apply({messages})).toEqual(messages);
	});

	it('shows a pending greeting under the authenticated account', () => {
		const result = apply({
			operations: {a: operation({from: owner, args: ['hi']})},
		});

		expect(result).toEqual([
			{account: owner, message: 'hi', timestamp: 1000, pending: true},
		]);
	});

	/**
	 * The reason this function exists. An app acting for its user sends from its
	 * own key, and the registry files the greeting under the account. Keying the
	 * optimistic entry off the SENDER would put it under an address the chain
	 * never reports, leaving a permanent duplicate next to the confirmed one.
	 */
	it('files a delegate-sent greeting under the owner, not the sender', () => {
		const result = apply({
			account: owner,
			operations: {
				a: operation({
					from: signer,
					functionName: 'setMessageFor',
					args: [owner, 'sent by the app'],
				}),
			},
		});

		expect(result).toEqual([
			{
				account: owner,
				message: 'sent by the app',
				timestamp: 1000,
				pending: true,
			},
		]);
		expect(result.some((view) => view.account === signer)).toBe(false);
	});

	it('replaces the account\u2019s confirmed greeting rather than duplicating it', () => {
		const result = apply({
			messages: [message(owner, 'old', 500), message(other, 'theirs', 400)],
			operations: {
				a: operation({
					from: signer,
					functionName: 'setMessageFor',
					args: [owner, 'new'],
				}),
			},
		});

		expect(result).toEqual([
			{account: owner, message: 'new', timestamp: 1000, pending: true},
			message(other, 'theirs', 400),
		]);
	});

	it('keeps the confirmed greeting when it says the same thing more recently', () => {
		const messages = [message(owner, 'same', 2000)];
		const result = apply({
			messages,
			operations: {
				a: operation({from: owner, args: ['same'], broadcastTimestampMs: 1000}),
			},
		});

		expect(result).toEqual(messages);
	});

	it('marks an included operation as no longer pending', () => {
		const [view] = apply({
			operations: {
				a: operation({from: owner, args: ['hi'], inclusion: 'Included'}),
			},
		});

		expect(view.pending).toBe(false);
	});

	it('ignores failed, dropped and not-found operations', () => {
		expect(
			apply({operations: {a: operation({from: owner, status: 'Failure'})}}),
		).toEqual([]);
		expect(
			apply({operations: {a: operation({from: owner, inclusion: 'Dropped'})}}),
		).toEqual([]);
		expect(
			apply({operations: {a: operation({from: owner, inclusion: 'NotFound'})}}),
		).toEqual([]);
	});

	it('ignores operations that are not greetings', () => {
		expect(
			apply({
				operations: {a: operation({from: owner, functionName: 'transfer'})},
			}),
		).toEqual([]);
	});

	describe('picking the latest of several', () => {
		it('prefers the higher nonce', () => {
			const [view] = apply({
				operations: {
					a: operation({from: owner, args: ['first'], nonce: 1}),
					b: operation({from: owner, args: ['second'], nonce: 2}),
				},
			});
			expect(view.message).toBe('second');
		});

		it('prefers the later broadcast at equal nonce (a resubmit)', () => {
			const [view] = apply({
				operations: {
					a: operation({
						from: owner,
						args: ['slow'],
						nonce: 1,
						broadcastTimestampMs: 1000,
					}),
					b: operation({
						from: owner,
						args: ['resubmitted'],
						nonce: 1,
						broadcastTimestampMs: 2000,
					}),
				},
			});
			expect(view.message).toBe('resubmitted');
		});

		it('breaks an exact tie on operationID, so the result is deterministic', () => {
			const [view] = apply({
				operations: {
					a: operation({from: owner, args: ['a']}),
					b: operation({from: owner, args: ['b']}),
				},
			});
			expect(view.message).toBe('b');
		});
	});

	it('overlays nothing while signed out', () => {
		const messages = [message(other, 'onchain', 500)];
		const result = apply({
			messages,
			account: undefined,
			operations: {a: operation({from: owner, args: ['hi']})},
		});

		expect(result).toEqual(messages);
	});

	it('truncates to maxMessages', () => {
		const result = apply({
			messages: [
				message(other, 'a', 300),
				message(stranger, 'b', 200),
				message(signer, 'c', 100),
			],
			operations: {a: operation({from: owner, args: ['mine']})},
			maxMessages: 2,
		});

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({account: owner, message: 'mine'});
	});
});
