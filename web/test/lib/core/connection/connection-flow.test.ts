import {describe, it, expect} from 'vitest';
import {
	isBurnerWalletInSelectionPhase,
	hasPendingWalletRequest,
	walletEntryMode,
	resolveSignInAddress,
	hasSwappedAccount,
	signInAdoptingSwap,
	signInToAccount,
	combinesAccountChoiceWithSignIn,
	effectiveAccountSelection,
	canDismissConnection,
} from '../../../../src/lib/core/connection/connection-flow';

const wallet = (name: string) => ({info: {name, icon: ''}});
const addr = (n: number) =>
	`0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;

describe('isBurnerWalletInSelectionPhase', () => {
	it('is true for an active burner wallet mechanism', () => {
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
			}),
		).toBe(true);
	});

	it('is false in Idle / MechanismToChoose or non-burner wallets', () => {
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'Idle',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
			}),
		).toBe(false);
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'MechanismToChoose',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
			}),
		).toBe(false);
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
			}),
		).toBe(false);
	});
});

describe('hasPendingWalletRequest', () => {
	it('is true when there are pending requests and not in burner selection', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
				wallet: {pendingRequests: [{}]},
			}),
		).toBe(true);
	});

	it('is false when there are no pending requests', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				wallet: {pendingRequests: []},
			}),
		).toBe(false);
	});

	it('is suppressed during the burner selection phase', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
				wallet: {pendingRequests: [{}]},
			}),
		).toBe(false);
	});
});

describe('walletEntryMode', () => {
	it('is none with no wallets (regardless of other options)', () => {
		expect(walletEntryMode([], false)).toBe('none');
		expect(walletEntryMode([], true)).toBe('none');
	});
	it('is single with exactly one wallet (regardless of other options)', () => {
		expect(walletEntryMode([wallet('MetaMask')], false)).toBe('single');
		expect(walletEntryMode([wallet('MetaMask')], true)).toBe('single');
	});
	it('shows the list directly when wallets are the only option', () => {
		expect(walletEntryMode([wallet('MetaMask'), wallet('Rabby')], false)).toBe(
			'list',
		);
	});
	it('collapses behind a button when sharing the modal with other options', () => {
		expect(walletEntryMode([wallet('MetaMask'), wallet('Rabby')], true)).toBe(
			'collapsed',
		);
	});
});

describe('resolveSignInAddress', () => {
	it('uses the connected account when no swap happened', () => {
		expect(
			resolveSignInAddress({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
				wallet: {},
			}),
		).toBe(addr(1));
	});

	it('prefers the swapped-to account over the stale mechanism address', () => {
		expect(
			resolveSignInAddress({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
				wallet: {accountChanged: addr(2)},
			}),
		).toBe(addr(2));
	});

	it('is undefined when neither is available', () => {
		expect(resolveSignInAddress({step: 'WalletToChoose'})).toBeUndefined();
	});
});

describe('hasSwappedAccount', () => {
	it('is true when accountChanged is set', () => {
		expect(
			hasSwappedAccount({
				step: 'WalletConnected',
				wallet: {accountChanged: addr(2)},
			}),
		).toBe(true);
	});
	it('is false when accountChanged is absent', () => {
		expect(hasSwappedAccount({step: 'WalletConnected', wallet: {}})).toBe(
			false,
		);
	});
});

describe('combinesAccountChoiceWithSignIn', () => {
	it('combines under a sign-in target', () => {
		expect(combinesAccountChoiceWithSignIn({targetStep: 'SignedIn'})).toBe(
			true,
		);
	});
	it('keeps the plain picker for wallet-only auth', () => {
		expect(
			combinesAccountChoiceWithSignIn({targetStep: 'WalletConnected'}),
		).toBe(false);
	});
});

describe('effectiveAccountSelection', () => {
	const accounts = [addr(1), addr(2), addr(3)];

	it("follows the wallet's active account (first) when the user has not picked", () => {
		expect(effectiveAccountSelection(accounts, undefined)).toBe(addr(1));
	});

	it('honours an explicit user choice', () => {
		expect(effectiveAccountSelection(accounts, addr(3))).toBe(addr(3));
	});

	it('matches the user choice case-insensitively', () => {
		const upper = addr(2).toUpperCase().replace('0X', '0x') as `0x${string}`;
		expect(effectiveAccountSelection(accounts, upper)).toBe(upper);
	});

	it('falls back to the active account when the choice left the list', () => {
		expect(effectiveAccountSelection([addr(1), addr(3)], addr(2))).toBe(
			addr(1),
		);
	});

	it('is undefined with no accounts', () => {
		expect(effectiveAccountSelection([], undefined)).toBeUndefined();
	});
});

describe('signInToAccount', () => {
	function makeStore(initial: any) {
		let value = initial;
		const subs = new Set<(v: any) => void>();
		const set = (v: any) => {
			value = v;
			for (const s of subs) s(value);
		};
		return {
			set,
			get: () => value,
			subscribe(run: (v: any) => void) {
				subs.add(run);
				run(value);
				return () => subs.delete(run);
			},
		};
	}

	it('adopts the account, waits for it to settle, then signs', async () => {
		const store = makeStore({
			step: 'ChooseWalletAccount',
			wallet: {accounts: [addr(1), addr(2)]},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: (address: `0x${string}`) => {
				calls.push(`connectToAddress:${address}`);
				store.set({
					step: 'WalletConnected',
					mechanism: {type: 'wallet', name: 'MetaMask', address},
					wallet: {},
				});
			},
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await signInToAccount(connection as never, addr(2));

		expect(calls).toEqual([`connectToAddress:${addr(2)}`, 'requestSignature']);
	});

	it('rejects (and does not sign) if the flow is cancelled while adopting', async () => {
		const store = makeStore({
			step: 'ChooseWalletAccount',
			wallet: {accounts: [addr(1), addr(2)]},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: () => {
				store.set({step: 'Idle'});
			},
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await expect(signInToAccount(connection as never, addr(2))).rejects.toThrow(
			/cancelled/,
		);
		expect(calls).toEqual([]);
	});
});

describe('signInAdoptingSwap', () => {
	// A tiny writable-store stand-in exposing only the surface the action uses.
	function makeStore(initial: any) {
		let value = initial;
		const subs = new Set<(v: any) => void>();
		const set = (v: any) => {
			value = v;
			for (const s of subs) s(value);
		};
		return {
			set,
			get: () => value,
			subscribe(run: (v: any) => void) {
				subs.add(run);
				run(value);
				return () => subs.delete(run);
			},
		};
	}

	it('signs directly when there was no swap', async () => {
		const store = makeStore({
			step: 'WalletConnected',
			mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
			wallet: {},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: () => calls.push('connectToAddress'),
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await signInAdoptingSwap(connection as never);

		expect(calls).toEqual(['requestSignature']);
	});

	it('adopts the swapped account then signs in one action', async () => {
		const store = makeStore({
			step: 'WalletConnected',
			mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
			wallet: {accountChanged: addr(2)},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: (address: `0x${string}`) => {
				calls.push('connectToAddress');
				// Simulate the store settling on the adopted account.
				store.set({
					step: 'WalletConnected',
					mechanism: {type: 'wallet', name: 'MetaMask', address},
					wallet: {},
				});
			},
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await signInAdoptingSwap(connection as never);

		expect(calls).toEqual(['connectToAddress', 'requestSignature']);
		expect(store.get().mechanism.address).toBe(addr(2));
	});

	it('rejects if the flow is cancelled while adopting', async () => {
		const store = makeStore({
			step: 'WalletConnected',
			mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
			wallet: {accountChanged: addr(2)},
		});
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: () => {
				store.set({step: 'Idle'});
			},
			requestSignature: async () => {},
		};

		await expect(signInAdoptingSwap(connection as never)).rejects.toThrow(
			/cancelled/,
		);
	});
});

describe('canDismissConnection: not losing a flow to a stray click', () => {
	// A wallet opens in its own window and takes the focus, so the first click
	// back on the page lands outside whatever dialog is up - which a dialog reads
	// as "close me". Cancelling there throws away a request the user has already
	// started answering, and the only symptom is that the flow silently stops.
	it('refuses a dismissal while the wallet is being waited on', () => {
		for (const step of [
			'WaitingForWalletConnection',
			'WaitingForSignature',
			'PopupLaunched',
		] as const) {
			expect(canDismissConnection({step} as never), step).toBe(false);
		}
	});

	it('refuses one while a wallet request is pending', () => {
		expect(
			canDismissConnection({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
				wallet: {pendingRequests: [{}]},
			} as never),
		).toBe(false);
	});

	it('allows one on the steps that are simply waiting for the user', () => {
		// Choosing a wallet, choosing an account, confirming a sign-in: nothing is
		// in flight, so clicking away means what it says.
		for (const step of [
			'WalletToChoose',
			'MechanismToChoose',
			'ChooseWalletAccount',
			'WalletConnected',
		] as const) {
			expect(canDismissConnection({step} as never), step).toBe(true);
		}
	});
});
