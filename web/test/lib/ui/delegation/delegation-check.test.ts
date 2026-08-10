import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	createDelegationCheckStore,
	NotRegisteredError,
} from '$lib/ui/delegation/delegation-check';
import {
	createConfirmation,
	type ConfirmationState,
} from '$lib/core/ui/confirm/confirmation';
import type {TopUpFlow} from '$lib/ui/credits/top-up-flow';
import type {DelegationStore} from '$lib/onchain/delegation';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;

/**
 * A stand-in for the registration flow: a store that is open while it runs, and
 * a way for the test to say how it ended.
 */
function fakeFlow() {
	const store = writable({open: false});
	const start = vi.fn(async () => {
		store.set({open: true});
	});
	return {
		flow: {subscribe: store.subscribe, start} as unknown as TopUpFlow,
		start,
		close: () => store.set({open: false}),
	};
}

function fakeDelegation(delegate: `0x${string}`) {
	const value = () => ({step: 'Loaded' as const, delegate, withdrawn: false});
	const store = writable(value());
	return {
		delegation: Object.assign(store, {
			update: vi.fn(async () => value()),
			status: writable({loading: false}),
		}) as unknown as DelegationStore,
		register: (address: `0x${string}`) => {
			delegate = address;
			store.set(value());
		},
	};
}

const RESUME = {action: 'Send your greeting', detail: 'Hello from here'};

function setup(delegate: `0x${string}`) {
	const {flow, start, close} = fakeFlow();
	const {delegation, register} = fakeDelegation(delegate);
	const confirmation = createConfirmation();
	const check = createDelegationCheckStore({
		delegation,
		topUp: flow,
		confirmation,
	});
	/** The question, once it is being asked. */
	const asking = () =>
		get(confirmation) as Extract<ConfirmationState, {step: 'asking'}>;
	return {check, confirmation, asking, start, close, register};
}

describe('ensureRegistered: when this browser is already authorised', () => {
	it('returns at once, without opening or asking anything', async () => {
		const {check, confirmation, start} = setup(SIGNER);

		await check.ensureRegistered({signer: SIGNER, resume: RESUME});

		expect(start).not.toHaveBeenCalled();
		expect(get(confirmation).step).toBe('idle');
		expect(get(check).step).toBe('idle');
	});
});

describe('ensureRegistered: when it is not', () => {
	it('waits for the registration and then ASKS before carrying on', async () => {
		// The point of the whole thing: the action that was interrupted comes back,
		// rather than the user having to notice the app forgot and ask again. It
		// comes back on their say-so, because by now they have been through a
		// wallet and several dialogs.
		const {check, asking, start, close, register} = setup(ZERO);

		let resumed = false;
		const pending = check
			.ensureRegistered({signer: SIGNER, resume: RESUME})
			.then(() => {
				resumed = true;
			});

		// The flow is on screen and nothing has resumed.
		await vi.waitFor(() => expect(get(check).step).toBe('registering'));
		expect(start).toHaveBeenCalled();
		expect(resumed).toBe(false);

		// It lands, and the flow closes.
		register(SIGNER);
		close();

		// Still not resumed: it asks first, and the question carries BOTH halves.
		// The gate says what changed; the caller says what to carry on with, and
		// what it will actually send.
		await vi.waitFor(() => expect(asking().step).toBe('asking'));
		expect(asking().confirmLabel).toBe(RESUME.action);
		expect(asking().detail).toBe(RESUME.detail);
		expect(asking().title).toMatch(/act for you/i);
		// The gate's own words never name the action: it has no idea what a
		// greeting is, and a template must not leak one app's vocabulary.
		expect(asking().explanation).not.toMatch(/greeting/i);
		expect(resumed).toBe(false);

		asking().onConfirm();
		await pending;

		expect(resumed).toBe(true);
		expect(get(check).step).toBe('idle');
	});

	it('gives up when the user closes the flow without registering', async () => {
		// Read from the CHAIN, not from how the flow ended: a flow can close for
		// reasons that say nothing about whether the registration landed.
		const {check, confirmation, close} = setup(ZERO);

		const pending = check.ensureRegistered({signer: SIGNER, resume: RESUME});
		await vi.waitFor(() => expect(get(check).step).toBe('registering'));
		close();

		await expect(pending).rejects.toBeInstanceOf(NotRegisteredError);
		expect(get(confirmation).step).toBe('idle');
		expect(get(check).step).toBe('idle');
	});

	it('treats declining the question as backing out, not as a failure', async () => {
		const {check, asking, close, register} = setup(ZERO);

		const pending = check.ensureRegistered({signer: SIGNER, resume: RESUME});
		await vi.waitFor(() => expect(get(check).step).toBe('registering'));
		register(SIGNER);
		close();
		await vi.waitFor(() => expect(asking().step).toBe('asking'));

		asking().onCancel();

		await expect(pending).rejects.toBeInstanceOf(NotRegisteredError);
		expect(get(check).step).toBe('idle');
	});

	it('does not trouble the user when the poll was merely behind', async () => {
		// A registration that just landed may not be in the polled value yet, and
		// sending the user through a flow with nothing left to do is worse than
		// one direct read.
		const {start} = setup(ZERO);
		const {delegation} = fakeDelegation(SIGNER);
		const fresh = createDelegationCheckStore({
			delegation,
			topUp: {subscribe: () => () => {}, start} as unknown as TopUpFlow,
			confirmation: createConfirmation(),
		});

		await fresh.ensureRegistered({signer: SIGNER, resume: RESUME});

		expect(start).not.toHaveBeenCalled();
	});
});
