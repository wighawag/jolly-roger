import {describe, it, expect} from 'vitest';
import {readable} from 'svelte/store';
import {UserRejectedRequestError} from 'viem';
import {setGreeting} from '../../../src/routes/demo/lib/setGreeting';
import type {SetGreetingDeps} from '../../../src/routes/demo/lib/setGreeting';
import {InsufficientFundsError} from '../../../src/lib/core/transaction';
import {NotRegisteredError} from '../../../src/lib/ui/delegation/delegation-check';

/**
 * How a FAILED send is routed, which is the half with a remedy attached.
 *
 * The happy path is covered end to end by the e2e suite; what cannot be seen
 * there is an account running dry between the pre-flight estimate and the node,
 * because it needs a chain that says no.
 */
const SIGNER = '0x1111111111111111111111111111111111111111';
const ACCOUNT = '0x2222222222222222222222222222222222222222';

function deps(overrides: {
	throws?: unknown;
	hasLocalSigner?: boolean;
	/** Who the chain says may act for the account. Defaults to the signer. */
	delegate?: string;
	/** The user backed out of authorising this browser. */
	notRegistered?: boolean;
	writeContract?: (args: unknown) => Promise<unknown>;
}) {
	const connectionState = {
		step: 'SignedIn',
		account: {address: ACCOUNT, signer: {address: SIGNER}},
	};
	return {
		connection: Object.assign(readable(connectionState), {
			ensureConnected: async () => {},
		}),
		delegation: Object.assign(
			readable({
				step: 'Loaded',
				delegate: overrides.delegate ?? SIGNER,
				withdrawn: false,
			}),
			{
				update: async () => ({
					step: 'Loaded',
					delegate: overrides.delegate ?? SIGNER,
					withdrawn: false,
				}),
			},
		),
		// The real one walks the user through authorising this browser and only
		// resolves once they choose to carry on. Here it answers immediately, so
		// these tests stay about what setGreeting does with the answer.
		delegationCheck: {
			ensureRegistered: async () => {
				if (overrides.notRegistered) throw new NotRegisteredError();
			},
		},
		signerExecutor: readable({
			status: 'ready',
			address: SIGNER,
			account: SIGNER,
			client: {
				writeContract:
					overrides.writeContract ??
					(async () => {
						throw overrides.throws;
					}),
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

describe('setGreeting, and who the greeting belongs to', () => {
	it('sends setMessageFor, attributing the greeting to the ACCOUNT', async () => {
		// The whole point of registering the signer as a delegate. Sending
		// `setMessage` would file the greeting under the signer, which is a key the
		// user never chose and cannot be recognised by.
		let sent: {functionName?: string; args?: unknown[]} | undefined;
		const result = await setGreeting(
			deps({
				writeContract: async (args) => {
					sent = args as {functionName?: string; args?: unknown[]};
					return '0xhash';
				},
			}),
			'hello',
		);

		expect(result.status).toBe('submitted');
		expect(sent?.functionName).toBe('setMessageFor');
		expect(sent?.args).toEqual([ACCOUNT, 'hello']);
	});

	it('does not send when the user backs out of authorising this browser', async () => {
		// `NotDelegate` is a transaction spent to learn something a read already
		// knows, and it says nothing the user can act on. So the authorisation is
		// settled first, and declining it is a cancellation - the same answer a
		// dismissed funds modal gives, and for the same reason: the user was shown
		// what was needed and said no.
		let sentAnything = false;
		const result = await setGreeting(
			deps({
				notRegistered: true,
				writeContract: async () => {
					sentAnything = true;
					return '0xhash';
				},
			}),
			'hello',
		);

		expect(result.status).toBe('cancelled');
		expect(sentAnything).toBe(false);
	});

	it('sends the greeting the user typed, however long the authorisation took', async () => {
		// The whole reason the check blocks instead of returning: the send that was
		// interrupted is the send that goes through, so the user does not have to
		// notice the app forgot and ask again.
		let sent: {args?: unknown[]} | undefined;
		const base = deps({
			writeContract: async (args) => {
				sent = args as {args?: unknown[]};
				return '0xhash';
			},
		});
		const result = await setGreeting(
			{
				...base,
				delegationCheck: {
					// Stands in for the whole detour: a wallet, maybe a faucet, an
					// account switch, and the question at the end.
					ensureRegistered: async () => {
						await new Promise((r) => setTimeout(r, 10));
					},
				},
			} as unknown as SetGreetingDeps,
			'hello',
		);

		expect(result.status).toBe('submitted');
		expect(sent?.args).toEqual([ACCOUNT, 'hello']);
	});
});

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
