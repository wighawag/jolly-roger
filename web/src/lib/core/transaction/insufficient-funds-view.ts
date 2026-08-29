import type {BalanceCheckState} from './balance-check-store';
import type {BalanceStore} from '$lib/core/connection/balance';
import {sameAddress} from '$lib/core/utils/ethereum/address';

/**
 * WHICH KIND OF ACCOUNT is short, which is the question this modal turns on.
 *
 * Not an address, and not a boolean. It was a boolean - `isAccount`, "the sender
 * is either the account the user signed in as or the local signer" - and that
 * was true only for as long as there were two accounts able to pay. There are
 * three, and under a boolean the third one silently became the second: a wallet
 * on the payment rail was described as the in-app spending account and offered a
 * top-up that funds a different address entirely, so the money moved, the modal
 * said it had worked, and the transaction failed for exactly the original
 * reason.
 *
 * As a kind, a fourth payer is a case the compiler asks about rather than a
 * fallthrough somebody has to notice.
 *
 * - `account`: the account the user signed in as. The faucet funds it.
 * - `signer`: the local signer this browser holds, which the user never chose
 *   and may not know exists. The faucet cannot fund it (see the faucet's own
 *   note on why not); a top-up through the payment rail can.
 * - `rail`: a wallet the user picked to pay with, on the payment rail. Neither
 *   of the above, and the faucet CAN fund it, because the faucet takes a target.
 * - `unknown`: the sender matched none of the payers this app knows about, or
 *   there is no sender at all. An honest answer, and the only one that must
 *   offer nothing (see `FundsRemedy`).
 */
export type PayerKind = 'account' | 'signer' | 'rail' | 'unknown';

/**
 * One account this app can send from, as told to the view.
 *
 * A LIST, supplied by the caller, rather than addresses this file goes and
 * finds: which payers exist is a property of the app, and they differ by branch
 * of this template (the base app has only `account`; a local-signer app has all
 * three). The view classifies, the app enumerates, and adding a payer is one
 * more entry rather than another comparison bolted onto a chain of them.
 *
 * `address` is allowed to be undefined because a payer can exist and not be
 * ready yet (an unconnected rail, a signer before sign-in). An entry with no
 * address simply never matches, which is the correct answer: it cannot be the
 * account that is short if we do not know what it is.
 */
export type KnownPayer = {
	kind: Exclude<PayerKind, 'unknown'>;
	address: `0x${string}` | undefined;
};

/**
 * THE ONE THING THAT WOULD FIX THIS SHORTFALL.
 *
 * A union rather than a set of `canX` booleans, and that is the whole point.
 * The rule the old booleans documented but could not enforce is that EXACTLY ONE
 * remedy applies to any given shortfall, because offering the wrong one is worse
 * than offering nothing: it appears to work, moves a balance nobody was waiting
 * on, and the transaction fails anyway. Two booleans can both be true, and the
 * component then decides the order it tests them in. One field cannot, so the
 * rule is now a property of the type instead of a sentence in a comment.
 *
 * - `faucet` carries the address to fund, so the caller cannot aim it at the
 *   wrong account: it is the account that is short, whichever that was. This is
 *   what lets the rail case work at all - `claimFaucet` has always taken a
 *   target, and only this view's two-payer assumption kept it from being used.
 * - `top-up` funds the local signer through the payment rail, and needs no
 *   address for the same reason: there is one signer, and the flow knows it.
 * - `none` is a real answer, not a failure. No faucet configured, or a sender
 *   this app cannot place. Saying nothing is the correct behaviour there.
 */
export type FundsRemedy =
	{kind: 'none'} | {kind: 'faucet'; target: `0x${string}`} | {kind: 'top-up'};

/**
 * WHO is short, in the words the modal has to use about them.
 *
 * The wording lives here rather than in the component because "the sentence
 * names the right account" is the requirement, and a requirement worth stating
 * is worth testing. It replaces `sentFromAnotherAccount`, which could say only
 * that the short account was not the user's own - enough to stop the modal
 * telling somebody with a funded account that their balance was zero, and not
 * enough once there were two accounts it could be instead of theirs.
 */
export type ShortPayer = {
	kind: PayerKind;
	address: `0x${string}` | undefined;
	/** Label for the balance row, e.g. `In-app balance:`. */
	balanceLabel: string;
	/** The sentence explaining what is short, naming which account it is. */
	explanation: string;
	/**
	 * Whether to show the address alongside the name.
	 *
	 * True only for the rail payer, and not for decoration: that is the one the
	 * user PICKED, from a wallet that may hold several accounts, so which one it
	 * is is both in doubt and checkable against what their wallet is showing
	 * them. Naming the other two by address would be noise; they had no choice
	 * to make.
	 */
	showAddress: boolean;
};

export type InsufficientFundsView = {
	/** The balance store to display (only present in the insufficient step). */
	balanceStore: BalanceStore | null;
	/** Live balance, defaulting to 0 while unloaded. */
	displayBalance: bigint;
	/** True once the (possibly updated) balance covers the estimated cost. */
	hasSufficientFunds: boolean;
	/** Missing amount, clamped to 0 when funds are sufficient. */
	shortfall: bigint;
	/** True while polling for a balance change after funding was requested. */
	isWaitingForBalanceUpdate: boolean;
	/** Which account is short, and how to name it. */
	payer: ShortPayer;
	/** The single remedy that would fix it, if there is one. */
	remedy: FundsRemedy;
};

type LoadedBalance = {step: 'Loaded'; value: bigint};

const WORDING: Record<
	PayerKind,
	{balanceLabel: string; explanation: string; showAddress: boolean}
> = {
	account: {
		balanceLabel: 'Your balance:',
		explanation: "You don't have enough funds to complete this transaction.",
		showAddress: false,
	},
	signer: {
		balanceLabel: 'In-app balance:',
		explanation:
			'Your in-app spending account does not have enough to complete this transaction. It is separate from the account you signed in with, and is funded separately.',
		showAddress: false,
	},
	rail: {
		balanceLabel: 'Wallet balance:',
		explanation:
			'The wallet you chose to pay with does not have enough to complete this transaction. It is not the account you signed in with, and not your in-app balance.',
		showAddress: true,
	},
	unknown: {
		balanceLabel: 'Balance:',
		// Deliberately vague, because being vague is honest here and guessing is
		// not: naming an account we failed to identify is the failure this whole
		// file exists to prevent, one sentence later.
		explanation:
			'The account this transaction is sent from does not have enough to complete it.',
		showAddress: true,
	},
};

/** The remedy for each kind of payer. The rail case is the one that was missing. */
function remedyFor(
	kind: PayerKind,
	address: `0x${string}` | undefined,
	faucetConfigured: boolean,
): FundsRemedy {
	switch (kind) {
		case 'account':
		case 'rail':
			// Same remedy, different target, which is precisely what the address
			// comparison could not express. The faucet funds an account; these are
			// the accounts it can be pointed at.
			return faucetConfigured && address
				? {kind: 'faucet', target: address}
				: {kind: 'none'};
		case 'signer':
			// The faucet deliberately will not fund the signer (it would let local
			// development skip the purchase flow that production has to use), so the
			// remedy is the purchase itself.
			return {kind: 'top-up'};
		case 'unknown':
			return {kind: 'none'};
	}
}

function classify(
	sender: `0x${string}` | undefined,
	payers: readonly KnownPayer[],
): PayerKind {
	if (!sender) return 'unknown';
	return (
		payers.find((payer) => sameAddress(payer.address, sender))?.kind ??
		'unknown'
	);
}

const NEUTRAL_PAYER: ShortPayer = {
	kind: 'unknown',
	address: undefined,
	...WORDING.unknown,
};

/**
 * Derive the display view-model for the insufficient-funds modal from the
 * balance-check state and the current value of its balance store.
 *
 * Pure: the `.svelte` file subscribes to the stores and passes their snapshots
 * here, keeping the balance math - and the choice of remedy, which is the part
 * that has been wrong twice - out of the component.
 */
export function deriveInsufficientFundsView(
	state: BalanceCheckState,
	currentBalance: {step: string; value?: bigint} | null,
	options: {
		/**
		 * Every account this app can send from. Order is irrelevant; an address
		 * belongs to at most one payer.
		 */
		payers?: readonly KnownPayer[];
		/** Whether a faucet is configured at all. */
		faucetConfigured?: boolean;
	} = {},
): InsufficientFundsView {
	if (state.step !== 'insufficient') {
		return {
			balanceStore: null,
			displayBalance: 0n,
			hasSufficientFunds: false,
			shortfall: 0n,
			isWaitingForBalanceUpdate: false,
			payer: NEUTRAL_PAYER,
			remedy: {kind: 'none'},
		};
	}

	const {payers = [], faucetConfigured = false} = options;

	const kind = classify(state.sender, payers);

	const loaded =
		currentBalance && currentBalance.step === 'Loaded'
			? (currentBalance as LoadedBalance)
			: null;
	const displayBalance = loaded ? loaded.value : 0n;
	const hasSufficientFunds = loaded
		? loaded.value >= state.estimatedCost
		: false;
	const shortfall =
		state.estimatedCost > displayBalance
			? state.estimatedCost - displayBalance
			: 0n;

	return {
		balanceStore: state.balanceStore,
		displayBalance,
		hasSufficientFunds,
		shortfall,
		isWaitingForBalanceUpdate: state.isWaitingForBalanceUpdate === true,
		payer: {
			kind,
			address: state.sender,
			...WORDING[kind],
		},
		remedy: remedyFor(kind, state.sender, faucetConfigured),
	};
}
