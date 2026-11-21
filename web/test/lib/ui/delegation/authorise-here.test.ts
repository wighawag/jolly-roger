import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {DELEGATION_ABI} from '$lib/onchain/delegation';
import {DEFAULT_TOP_UP_CEILING} from '$lib/ui/credits/top-up-flow';
import {
	authoriseTheBrowsersKey,
	type AuthorisationDeps,
} from '$lib/ui/delegation/authorise-here';

// No `.svelte.` infix: the `server` project. The five members the function
// takes are faked, each the least of itself the function reads, so what is
// pinned is the decision (already, register, or refuse) and the one
// transaction it sends, not the delegation flow's own modules.

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const DELEGATE = '0x2222222222222222222222222222222222222222' as const;
const REGISTRY = '0x3333333333333333333333333333333333333333' as const;

function deps(options: {
	signedIn?: boolean;
	registered?: boolean;
	executor?: 'ready' | 'loading';
	receipt?: 'success' | 'reverted';
}) {
	const {
		signedIn = true,
		registered = false,
		executor = 'ready',
		receipt = 'success',
	} = options;

	const connection = writable(
		signedIn
			? {
					step: 'SignedIn',
					account: {
						address: OWNER,
						signer: {address: DELEGATE},
						savedDelegations: [],
						permissions: undefined,
					},
					wallet: {},
				}
			: {step: 'WalletConnected'},
	);

	// The chain's answer: registered from the start, or once the transaction
	// below has landed.
	let allowed = registered;
	const delegationValue = writable({step: 'Loaded', allowed, withdrawn: false});
	const update = vi.fn(async () => {
		delegationValue.set({step: 'Loaded', allowed, withdrawn: false});
	});
	const delegation = {
		subscribe: delegationValue.subscribe,
		update,
		registry: {chainId: 31337, address: REGISTRY, abi: DELEGATION_ABI},
	};

	const writeContract = vi.fn(async () => {
		if (receipt === 'success') allowed = true;
		return '0xabc' as const;
	});
	const accountExecutor = writable(
		executor === 'ready'
			? {status: 'ready', client: {writeContract}, account: OWNER}
			: {status: executor},
	);
	const publicClient = {
		waitForTransactionReceipt: vi.fn(async () => ({status: receipt})),
	};

	return {
		deps: {
			connection,
			delegation,
			accountExecutor,
			publicClient,
			credits: undefined,
		} as unknown as AuthorisationDeps,
		writeContract,
		update,
	};
}

describe("authoriseTheBrowsersKey: the world authorising this browser's key itself", () => {
	it('sends nothing when the chain already says this browser may act', async () => {
		const fake = deps({registered: true});
		expect(await authoriseTheBrowsersKey(fake.deps)).toEqual({
			step: 'AlreadyAuthorised',
		});
		expect(fake.writeContract).not.toHaveBeenCalled();
		// Asked fresh, not read off whatever the poll last saw.
		expect(fake.update).toHaveBeenCalled();
	});

	it('registers the key by one transaction, funding it, and reads the answer back', async () => {
		const fake = deps({});
		expect(await authoriseTheBrowsersKey(fake.deps)).toEqual({
			step: 'Authorised',
		});
		expect(fake.writeContract).toHaveBeenCalledTimes(1);
		expect(fake.writeContract).toHaveBeenCalledWith(
			expect.objectContaining({
				address: REGISTRY,
				functionName: 'registerDelegate',
				args: [DELEGATE, DELEGATE],
				value: DEFAULT_TOP_UP_CEILING,
				account: OWNER,
			}),
		);
		// Once before deciding, once after, so a gate reading it sees the key.
		expect(fake.update).toHaveBeenCalledTimes(2);
	});

	it('refuses, sending nothing, when nobody is signed in', async () => {
		const fake = deps({signedIn: false});
		expect(await authoriseTheBrowsersKey(fake.deps)).toEqual({
			step: 'Refused',
			reason: 'nobody is signed in to this world',
		});
		expect(fake.writeContract).not.toHaveBeenCalled();
	});

	it('refuses, sending nothing, while the account cannot send', async () => {
		const fake = deps({executor: 'loading'});
		const outcome = await authoriseTheBrowsersKey(fake.deps);
		expect(outcome.step).toBe('Refused');
		expect(fake.writeContract).not.toHaveBeenCalled();
	});

	it('refuses when the registration reverts, rather than claiming the key is authorised', async () => {
		const fake = deps({receipt: 'reverted'});
		const outcome = await authoriseTheBrowsersKey(fake.deps);
		expect(outcome.step).toBe('Refused');
		expect(fake.writeContract).toHaveBeenCalledTimes(1);
	});
});
