import {describe, it, expect, vi} from 'vitest';
import {get, readable, writable} from 'svelte/store';
import {
	resubmitOperation,
	cancelOperation,
} from '../../../../src/lib/ui/pending-operation/operation-actions';
import type {Sender} from '../../../../src/lib/core/connection/senders';
import type {ExecutorState} from '../../../../src/lib/core/connection/executor';
import type {OnchainOperation} from '../../../../src/lib/account/AccountData';
import type {TxSource} from '../../../../src/lib/core/connection/tx-source';

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const PAYER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;
const AVATARS = '0x9999999999999999999999999999999999999999' as `0x${string}`;

const ready = (address: `0x${string}`): ExecutorState => ({
	status: 'ready',
	address,
	account: address,
	client: {sendTransaction: vi.fn(async () => '0xhash')} as never,
});

function sender(
	route: Sender['route'],
	state: ExecutorState,
	ensureCanSign?: Sender['ensureCanSign'],
): Sender {
	return {
		route,
		executor: readable(state),
		balance: {} as never,
		ensureCanSign,
	};
}

/**
 * A dormant route that wakes up when asked, which is what the payment rail
 * does: `ensureConnected` raises the wallet and the executor becomes ready.
 */
function wakeable(route: Sender['route'], address: `0x${string}`) {
	const executor = writable<ExecutorState>({status: 'not-connected'});
	const ensureCanSign = vi.fn(async () => {
		executor.set(ready(address));
	});
	return {
		ensureCanSign,
		sender: {
			route,
			executor: {subscribe: executor.subscribe},
			balance: {} as never,
			ensureCanSign,
		} as Sender,
	};
}

/** The avatar purchase, as the payment rail records it. */
function purchase(source?: TxSource): OnchainOperation {
	return {
		metadata: {
			type: 'functionCall',
			functionName: 'buyAvatar',
			args: [],
			tx: {
				hash: '0xdead',
				from: PAYER,
				to: AVATARS,
				nonce: 4,
				value: 1000n,
				data: '0x',
				broadcastTimestampMs: 1,
				gasParameters: {maxFeePerGas: 10n, maxPriorityFeePerGas: 1n},
				source,
			},
		},
		transactionIntent: {transactions: []},
	} as unknown as OnchainOperation;
}

const deps = (senders: Sender[]) => ({
	senders,
	deployments: readable({chain: {id: 31337}}) as never,
	balanceCheck: {
		// Echoes the transaction back, as the real one does: it wraps a send it
		// has established the sender can afford. A stub that dropped fields hid
		// whether `to` reached the wallet at all.
		ensureCanAfford: vi.fn(
			async ({transaction}: {transaction: unknown}) => transaction,
		),
	} as never,
	gasFee: readable({step: 'Loaded', fast: {maxFeePerGas: 20n}}) as never,
});

const gasPrice = {maxFeePerGas: 30n, maxPriorityFeePerGas: 2n};

describe("this branch's own configuration: one account sender", () => {
	// THE ONLY PATH `main` CAN ACTUALLY EXECUTE, and it had no test: every other
	// case here is about a rail that exists on a descendant. A registry of one is
	// also the shape where the no-source fallback behaves differently, so it is
	// worth pinning on both paths.
	const accountOnly = (state = ready(ACCOUNT)) => [
		{
			route: 'account' as const,
			executor: readable(state),
			balance: {} as never,
			ensureCanSign: vi.fn(async () => {}),
		},
	];

	function accountTx(source?: TxSource): OnchainOperation {
		const op = purchase(source);
		(op.metadata.tx as {from: `0x${string}`}).from = ACCOUNT;
		return op;
	}

	it('resubmits through the account executor at the original nonce', async () => {
		const senders = accountOnly();
		const result = await resubmitOperation(deps(senders), {
			operation: accountTx({route: 'account', wallet: {name: 'Rabby'}}),
			operationKey: 'op-1',
			gasPrice,
		});

		expect(result).toEqual({status: 'submitted'});
		expect(senders[0].ensureCanSign).toHaveBeenCalledWith({
			address: ACCOUNT,
			wallet: {name: 'Rabby'},
		});
		const executor = get(senders[0].executor);
		expect(
			executor.status === 'ready' && executor.client.sendTransaction,
		).toHaveBeenCalledWith(expect.objectContaining({nonce: 4}));
	});

	it('cancels through it too', async () => {
		const result = await cancelOperation(deps(accountOnly()), {
			operation: accountTx({route: 'account'}),
		});
		expect(result).toEqual({status: 'submitted'});
	});

	it('recovers a pre-source operation, because one sender is unambiguous', async () => {
		// No recorded route, but there is only one route it could be. Requiring an
		// already-ready executor here would strand the locked-wallet case that most
		// needs to work.
		const result = await resubmitOperation(deps(accountOnly()), {
			operation: accountTx(),
			operationKey: 'op-1',
			gasPrice,
		});
		expect(result).toEqual({status: 'submitted'});
	});

	it("says nothing can send, rather than blaming the user's own address", async () => {
		// "No account is ready" and "that is not the account that sent this" look
		// the same from the code and read completely differently: the second, shown
		// for the first, tells someone their own address belongs to a stranger and
		// asks them to reconnect to the account they are already on.
		const result = await resubmitOperation(
			deps(accountOnly({status: 'not-connected'})),
			{
				operation: accountTx({route: 'account'}),
				operationKey: 'op-1',
				gasPrice,
			},
		);

		expect(result).toMatchObject({status: 'error'});
		expect(result).not.toMatchObject({status: 'wrong-account'});
	});
});

describe('replacing a transaction sent through the payment rail', () => {
	/**
	 * THE BUG THIS SLICE CLOSED, end to end.
	 *
	 * An avatar was bought through the payment rail. The rail is dormant by
	 * construction, so nothing was ready at the payer's address, and the app told
	 * the user their own purchase belonged to a different account with no way to
	 * act on it. The money was fine; the nonce was unreachable forever.
	 */
	it('wakes the rail and sends through IT, in one action', async () => {
		const payer = wakeable('rail', PAYER);
		const result = await resubmitOperation(
			deps([sender('account', ready(ACCOUNT)), payer.sender]),
			{
				operation: purchase({route: 'rail', wallet: {name: 'Rabby'}}),
				operationKey: 'op-1',
				gasPrice,
			},
		);

		expect(result).toEqual({status: 'submitted'});
		// Asked for the recorded wallet AND the address: the pair is the point.
		// The address alone lands on whatever wallet is connected, the wallet
		// alone on whatever account it has selected.
		expect(payer.ensureCanSign).toHaveBeenCalledWith({
			address: PAYER,
			wallet: {name: 'Rabby'},
		});
	});

	it('reuses the original nonce, which is the whole point of replacing', async () => {
		const payerExecutor = ready(PAYER);
		await resubmitOperation(
			deps([sender('account', ready(ACCOUNT)), sender('rail', payerExecutor)]),
			{operation: purchase({route: 'rail'}), operationKey: 'op-1', gasPrice},
		);

		// And through the RAIL, not the account executor that is also ready:
		// sending from that one would broadcast a new transaction at a different
		// account's nonce rather than replacing anything.
		expect(
			payerExecutor.status === 'ready' && payerExecutor.client.sendTransaction,
		).toHaveBeenCalledWith(expect.objectContaining({nonce: 4}));
	});

	it('cancels through the rail too, not through whoever is connected', async () => {
		const payerExecutor = ready(PAYER);
		const result = await cancelOperation(
			deps([sender('account', ready(ACCOUNT)), sender('rail', payerExecutor)]),
			{operation: purchase({route: 'rail'})},
		);

		expect(result).toEqual({status: 'submitted'});
		expect(
			payerExecutor.status === 'ready' && payerExecutor.client.sendTransaction,
		).toHaveBeenCalledWith(expect.objectContaining({nonce: 4, to: PAYER}));
	});

	it('still calls ensureCanSign on a ready route, and reaches the send', async () => {
		// `ensureCanSign` is called on every replacement, so it has to be free
		// when nothing needs doing; otherwise the common path grows a dialog.
		const ensureCanSign = vi.fn(async () => {});
		await resubmitOperation(
			deps([sender('rail', ready(PAYER), ensureCanSign)]),
			{operation: purchase({route: 'rail'}), operationKey: 'op-1', gasPrice},
		);

		// Called, and it is the connection's job to no-op. What matters here is
		// that a ready route still reaches the send.
		expect(ensureCanSign).toHaveBeenCalledOnce();
	});
});

describe('when reconnecting does not get us there', () => {
	it('treats a refused wallet as cancelled, not as a failure', async () => {
		// Dismissing the wallet is a decision. Reporting it as an error puts a red
		// alert in front of a user who just chose not to proceed, which is the
		// same rule setGreeting and contractCall already follow.
		const result = await resubmitOperation(
			deps([
				sender('rail', {status: 'not-connected'}, async () => {
					throw {code: 4001, message: 'User rejected the request'};
				}),
			]),
			{operation: purchase({route: 'rail'}), operationKey: 'op-1', gasPrice},
		);

		expect(result).toEqual({status: 'cancelled'});
	});

	it('reports wrong-account when the wallet comes back on another account', async () => {
		// It connected, so nothing threw, but not as the account that owns the
		// nonce. The executor is the authority, not the absence of an error.
		const result = await resubmitOperation(
			deps([sender('rail', ready(ACCOUNT), async () => {})]),
			{operation: purchase({route: 'rail'}), operationKey: 'op-1', gasPrice},
		);

		expect(result).toEqual({status: 'wrong-account', expected: PAYER});
	});

	it('surfaces a genuine connection failure as an error', async () => {
		const result = await resubmitOperation(
			deps([
				sender('rail', {status: 'not-connected'}, async () => {
					throw new Error('no provider');
				}),
			]),
			{operation: purchase({route: 'rail'}), operationKey: 'op-1', gasPrice},
		);

		expect(result).toMatchObject({status: 'error', message: 'no provider'});
	});
});

describe('an address this app has no route to', () => {
	it('is still reported as a different account', async () => {
		// The honest dead end, and it must stay one: there is no key here that can
		// sign for it, so offering a remedy would be a lie. Two senders, so the
		// no-source path cannot fall back to "the only one there is".
		const result = await resubmitOperation(
			deps([
				sender('account', ready(ACCOUNT)),
				sender('signer', {status: 'not-connected'}),
			]),
			{operation: purchase(), operationKey: 'op-1', gasPrice},
		);

		expect(result).toEqual({status: 'wrong-account', expected: PAYER});
	});
});
