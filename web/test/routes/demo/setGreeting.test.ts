import {describe, it, expect} from 'vitest';
import {readable} from 'svelte/store';
import {UserRejectedRequestError} from 'viem';
import {setGreeting} from '../../../src/routes/demo/lib/setGreeting';
import type {SetGreetingDeps} from '../../../src/routes/demo/lib/setGreeting';
import {InsufficientFundsError} from '../../../src/lib/core/transaction';

/**
 * How a FAILED send is routed, which is the half with a remedy attached.
 *
 * The happy path is covered end to end by the e2e suite; what cannot be seen
 * there is an account running dry between the pre-flight estimate and the node,
 * because it needs a chain that says no.
 */
function deps(overrides: {throws: unknown; hasLocalSigner?: boolean}) {
	return {
		connection: {ensureConnected: async () => {}},
		signerExecutor: readable({
			status: 'ready',
			address: '0x1111111111111111111111111111111111111111',
			account: '0x1111111111111111111111111111111111111111',
			client: {
				writeContract: async () => {
					throw overrides.throws;
				},
			},
		}),
		signerBalance: readable({step: 'Loaded', value: 0n}),
		hasLocalSigner: overrides.hasLocalSigner ?? true,
		deployments: readable({
			contracts: {GreetingsRegistry: {address: '0x2', abi: []}},
		}),
		balanceCheck: {
			// Passes, deliberately: this is the case the pre-flight check missed.
			ensureCanAfford: async (options: {contract: unknown}) => options.contract,
		},
	} as unknown as SetGreetingDeps;
}

describe('setGreeting, when the send fails', () => {
	it('reports an account that cannot pay, and offers the top-up', async () => {
		const result = await setGreeting(
			deps({throws: new Error('insufficient funds for gas * price + value')}),
			'hello',
		);

		expect(result.status).toBe('cannot-pay');
		expect(result).toMatchObject({canTopUp: true});
	});

	it('does not offer the top-up when no local signer sent it', async () => {
		// Topping up funds the SIGNER. On the wallet fallback that moves money
		// nobody is waiting on and the transaction fails again, so the offer is
		// worse than no offer.
		const result = await setGreeting(
			deps({
				throws: new Error("Sender doesn't have enough funds to send tx"),
				hasLocalSigner: false,
			}),
			'hello',
		);

		expect(result.status).toBe('cannot-pay');
		expect(result).toMatchObject({canTopUp: false});
	});

	it('still treats a dismissed funds modal as a cancellation', async () => {
		// The ordering the classifier documents: a dismissed modal IS an account
		// that cannot pay, and it is still a cancellation, because the user was
		// shown the shortfall and said no. Routing it to `cannot-pay` would pop a
		// toast offering the remedy they just declined.
		const result = await setGreeting(
			deps({throws: new InsufficientFundsError(0n, 100n)}),
			'hello',
		);

		expect(result.status).toBe('cancelled');
	});

	it('still treats a rejected wallet prompt as a cancellation', async () => {
		const result = await setGreeting(
			deps({throws: new UserRejectedRequestError(new Error('denied'))}),
			'hello',
		);

		expect(result.status).toBe('cancelled');
	});

	it('leaves an ordinary revert as a plain error', async () => {
		const result = await setGreeting(
			deps({throws: new Error('execution reverted: MessageTooLong')}),
			'hello',
		);

		expect(result.status).toBe('error');
	});
});
