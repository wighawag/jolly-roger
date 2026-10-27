import {describe, it, expect} from 'vitest';
import {
	walletAutoApproves,
	activeWalletInfo,
	hasPendingWalletRequest,
	walletEntryMode,
	resolveSignInAddress,
	hasSwappedAccount,
	signInAdoptingSwap,
	signInToAccount,
	combinesAccountChoiceWithSignIn,
	effectiveAccountSelection,
	canDismissConnection,
	walletLockState,
	chainSwitchCopy,
} from '../../../../src/lib/core/connection/connection-flow';

const wallet = (name: string) => ({info: {name, icon: ''}});
const addr = (n: number) =>
	`0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;

/** A full `WalletInfo`, as a handle or a stamped wallet state carries it. */
const info = (name: string, autoApproves?: boolean) => ({
	uuid: `uuid:${name}`,
	name,
	icon: '',
	rdns: `test.${name.toLowerCase().replace(/\s+/g, '-')}`,
	...(autoApproves === undefined ? {} : {autoApproves}),
});
/** The offered wallets: one that never prompts, one that says nothing. */
const silentAndLoud = [
	{info: info('Silent Wallet', true)},
	{info: info('MetaMask')},
];

describe('walletAutoApproves', () => {
	it('is true once a wallet that declared autoApproves is connected', () => {
		expect(
			walletAutoApproves({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Silent Wallet'},
				wallet: {info: info('Silent Wallet', true)},
			}),
		).toBe(true);
	});

	it('finds the chosen handle by its name before a wallet state exists', () => {
		// WaitingForWalletConnection: `wallet` is undefined, only the mechanism
		// names the wallet, and the offered list says what it is.
		expect(
			walletAutoApproves({
				step: 'WaitingForWalletConnection',
				mechanism: {type: 'wallet', name: 'Silent Wallet'},
				wallets: silentAndLoud,
			}),
		).toBe(true);
	});

	it('does not care what the wallet is called', () => {
		// The old check matched the name "Burner Wallet". A burner announced
		// under another name is still silent, and a wallet that merely calls
		// itself that is not, unless it says so.
		expect(
			walletAutoApproves({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Dev Burner'},
				wallet: {info: info('Dev Burner', true)},
			}),
		).toBe(true);
		expect(
			walletAutoApproves({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
				wallet: {info: info('Burner Wallet')},
			}),
		).toBe(false);
	});

	it('is false for a wallet that prompts, or one it cannot identify', () => {
		expect(
			walletAutoApproves({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
				wallets: silentAndLoud,
			}),
		).toBe(false);
		expect(
			walletAutoApproves({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Unlisted'},
				wallets: silentAndLoud,
			}),
		).toBe(false);
		expect(
			walletAutoApproves({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Silent Wallet'},
			}),
		).toBe(false);
	});

	it('is false before a wallet is picked, and for a non-wallet mechanism', () => {
		for (const step of ['Idle', 'MechanismToChoose'] as const) {
			expect(
				walletAutoApproves({
					step,
					mechanism: {type: 'wallet', name: 'Silent Wallet'},
					wallets: silentAndLoud,
				}),
			).toBe(false);
		}
		expect(
			walletAutoApproves({
				step: 'SignedIn',
				mechanism: {type: 'email', name: 'Silent Wallet'},
				wallets: silentAndLoud,
			}),
		).toBe(false);
	});

	it('does not guess by name when the wallet state carries no info', () => {
		// connect leaves `wallet.info` absent when it cannot tell which handle the
		// provider came from; borrowing a same-named handle's flag would silence a
		// request the user is really being asked about.
		expect(
			walletAutoApproves({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Silent Wallet'},
				wallet: {},
				wallets: silentAndLoud,
			}),
		).toBe(false);
	});

	it('is false while no wallet is named yet (WalletToChoose)', () => {
		expect(
			walletAutoApproves({
				step: 'WalletToChoose',
				mechanism: {type: 'wallet'},
				wallets: silentAndLoud,
			}),
		).toBe(false);
	});

	it('prefers the stamped info over the list', () => {
		expect(
			activeWalletInfo({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Silent Wallet'},
				wallet: {info: info('Silent Wallet')},
				wallets: silentAndLoud,
			})?.autoApproves,
		).toBeUndefined();
	});
});

describe('hasPendingWalletRequest', () => {
	it('is true when there are pending requests and the wallet prompts', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
				pendingRequests: [{}],
			}),
		).toBe(true);
	});

	it('is false when there are no pending requests', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				pendingRequests: [],
			}),
		).toBe(false);
	});

	it('is suppressed for a wallet that never prompts', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Silent Wallet'},
				wallets: silentAndLoud,
				pendingRequests: [{}],
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
			expect(canDismissConnection({step}), step).toBe(false);
		}
	});

	it('refuses one while a wallet request is pending', () => {
		expect(
			canDismissConnection({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
				pendingRequests: [{}],
			}),
		).toBe(false);
	});

	it('allows one while connecting to a wallet that never prompts', () => {
		// hasPendingWalletRequest suppresses itself for a wallet that declared
		// autoApproves, so a pending request there does not freeze the flow.
		// Nothing is waiting on a human in another window, so there is nothing to
		// protect.
		expect(
			canDismissConnection({
				step: 'ChooseWalletAccount',
				mechanism: {type: 'wallet', name: 'Silent Wallet'},
				wallet: {info: info('Silent Wallet', true)},
				pendingRequests: [{}],
			}),
		).toBe(true);
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
			expect(canDismissConnection({step}), step).toBe(true);
		}
	});
});

describe('walletLockState: a locked wallet is not a connected one', () => {
	// The bug this exists for: locking keeps `step: 'WalletConnected'`, so every
	// `isTargetStepReached` branch in the navbar rendered a locked wallet exactly
	// like a working one. Measured with a transaction parked and the wallet
	// locked: the navbar showed a balance, and the page offered no Connect, no
	// Unlock and no hint that the wallet was refusing everything.
	it('reads a connected wallet as unlocked', () => {
		expect(
			walletLockState({step: 'WalletConnected', wallet: {status: 'connected'}}),
		).toBe('unlocked');
	});

	it('reads a locked wallet as locked, whatever the step says', () => {
		// The step deliberately still says WalletConnected here. That is the whole
		// trap: this is the state the rest of the app calls "connected".
		expect(
			walletLockState({
				step: 'WalletConnected',
				wallet: {status: 'locked', unlocking: false},
			}),
		).toBe('locked');
	});

	it('separates unlocking, so the remedy is not offered twice', () => {
		// The wallet's own password prompt is up. A live Unlock button invites a
		// second `unlock()` that does nothing the user can see.
		expect(
			walletLockState({
				step: 'WalletConnected',
				wallet: {status: 'locked', unlocking: true},
			}),
		).toBe('unlocking');
	});

	it('does NOT treat disconnected as locked', () => {
		// Different remedy, and offering the wrong one is a dead end the user
		// cannot tell from a broken app: disconnected means the wallet revoked this
		// site, which needs a fresh connect (a permission prompt), where locked
		// needs an unlock (a password prompt).
		expect(
			walletLockState({
				step: 'WalletConnected',
				wallet: {status: 'disconnected'},
			}),
		).toBe('unlocked');
	});

	it('says unlocked when there is no wallet at all', () => {
		// Every wallet-less step: nothing to unlock, and the Connect path is right.
		expect(walletLockState({step: 'Idle'})).toBe('unlocked');
		expect(walletLockState({step: 'WalletToChoose'})).toBe('unlocked');
	});
});

describe('chainSwitchCopy: adding a network is not switching to one', () => {
	// @etherplay/connect 0.11.2 publishes WHICH of the two chain prompts is up,
	// and documents that a consumer wording them the same way asks the user to
	// approve something other than what their wallet is showing. This app said
	// "Switching..." for both, over one sentence about "the network switch".
	it('names adding while the wallet is asking to add', () => {
		const copy = chainSwitchCopy({
			step: 'WalletConnected',
			wallet: {switchingChain: 'addingChain'},
		});
		expect(copy.action).toContain('Adding');
		expect(copy.hint).toContain('add it first');
		expect(copy.busy).toBe(true);
	});

	it('names switching while the wallet is asking to switch', () => {
		const copy = chainSwitchCopy({
			step: 'WalletConnected',
			wallet: {switchingChain: 'switchingChain'},
		});
		expect(copy.action).toBe('Switching...');
		expect(copy.hint).toContain('approve the network switch');
		expect(copy.busy).toBe(true);
	});

	it('hedges before anything has been asked', () => {
		// Nothing is up yet, and a wallet already on this network may not prompt at
		// all, so this is the one place "might" is the honest word.
		const copy = chainSwitchCopy({
			step: 'WalletConnected',
			wallet: {switchingChain: false},
		});
		expect(copy.action).toBe('Switch Network');
		expect(copy.hint).toContain('might prompt');
		expect(copy.busy).toBe(false);
	});
});
