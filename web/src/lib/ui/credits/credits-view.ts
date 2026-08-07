import {derived, type Readable} from 'svelte/store';
import type {Connection, UnderlyingEthereumProvider} from '@etherplay/connect';
import {formatBalance} from '$lib/core/utils/format/balance';
import {
	formatCredits,
	toCredits,
	type CreditsConfig,
} from '$lib/core/connection/credits';
import type {SignerBalanceValue} from '$lib/core/connection/signerBalance';
import type {Context} from '$lib/context/types';

/**
 * Who the signer is, from the app's point of view.
 *
 * `ownerHasWallet` is carried along because "can this user pay for their own
 * credits from the account they signed in with" is not answered by a balance:
 * an email/social sign-in has an owner address but no key to sign with.
 */
export type SignerAccount = {
	address: `0x${string}`;
	owner: `0x${string}`;
	ownerHasWallet: boolean;
};

export type CreditsViewInput = {
	/** Undefined until a signer exists (i.e. until the connection is SignedIn). */
	signer: SignerAccount | undefined;
	/** Latest value of the signer-balance poller. */
	balances: SignerBalanceValue;
	/** Credits denomination, or undefined to show native currency. */
	credits: CreditsConfig | undefined;
	/**
	 * Whether the signer is also the address that pays for transactions, i.e.
	 * `PUBLIC_EXECUTION_MODE=signer`. In that mode the top bar's existing balance
	 * is ALREADY the signer's, which changes what is worth showing twice.
	 */
	signerIsSpender: boolean;
	symbol: string;
	decimals: number;
};

export type CreditsView = {
	/** Whether the signer section renders at all. */
	visible: boolean;
	/** Whether the figures below are credits rather than native currency. */
	denominatedInCredits: boolean;
	/** User-facing name for the signer account. */
	label: string;
	/** One line explaining what this account is, in a player's terms. */
	description: string;
	signerAddress: `0x${string}` | undefined;
	ownerAddress: `0x${string}` | undefined;
	/** The signer's balance, in whichever unit is being shown; null until loaded. */
	signerText: string | null;
	/**
	 * Whether to render that figure. The account panel already shows the SPENDING
	 * balance above this section, so when the signer is the spender, repeating it
	 * here in the same unit would print one number twice. Credits escape that:
	 * they are a different reading of the balance, not a copy of it.
	 */
	showSignerBalance: boolean;
	/** The owner's balance, always in native currency; null until loaded. */
	ownerText: string | null;
	/**
	 * Whether to render the owner's balance. Only when the signer is the spender:
	 * otherwise the panel's SPENDING balance is already the owner's.
	 */
	showOwnerBalance: boolean;
	/** The signer holds nothing and cannot pay for a single action. */
	needsFunding: boolean;
	/** Whether the compact top-bar indicator renders. */
	showTopBarIndicator: boolean;
	/** Text for that indicator. */
	topBarText: string;
	/** Label for the action that funds the signer. */
	topUpLabel: string;
	/**
	 * Whether the top-up asks for an amount. A configured credit unit gives a
	 * fixed price per top-up, so there is nothing to ask; without one there is no
	 * sensible preset and the user has to say how much.
	 */
	topUpNeedsAmount: boolean;
};

const HIDDEN: CreditsView = {
	visible: false,
	denominatedInCredits: false,
	label: '',
	description: '',
	signerAddress: undefined,
	ownerAddress: undefined,
	signerText: null,
	showSignerBalance: false,
	ownerText: null,
	showOwnerBalance: false,
	needsFunding: false,
	showTopBarIndicator: false,
	topBarText: '',
	topUpLabel: '',
	topUpNeedsAmount: false,
};

/**
 * Naming. "Signer" is an implementation word: it means a private key this
 * browser holds, which is not something a player has any reason to know. What
 * they can act on is which account PAYS, and the app already calls that the
 * spending account (see lib/context). So the signer inherits that name when it
 * is in fact the payer, and is named as a subordinate spending account when the
 * wallet pays instead - calling it "the spending account" in that mode would
 * point the user at the wrong balance when a wallet transaction fails.
 */
function labelFor(signerIsSpender: boolean): string {
	return signerIsSpender ? 'Spending account' : 'In-app spending account';
}

function describe(signerIsSpender: boolean): string {
	return signerIsSpender
		? 'Pays for every transaction you make here. Held in this browser, and separate from your account.'
		: 'Held in this browser so the app can act on your behalf. Separate from your account, and funded separately.';
}

/**
 * Derive everything the credits UI shows from a single snapshot.
 *
 * Pure, so the rules below can be argued with in tests rather than by clicking
 * through the combinations of execution mode, sign-in method and chain config
 * that produce them. The components subscribe to the stores and render what
 * comes back.
 */
export function deriveCreditsView(input: CreditsViewInput): CreditsView {
	const {signer, balances, credits, signerIsSpender, symbol, decimals} = input;

	// No signer: wallet-only deployments, and every step before sign-in. Nothing
	// here has an address to talk about, so the whole section stays out of the
	// DOM rather than rendering an empty shell.
	if (!signer) return HIDDEN;

	const loaded = balances.step === 'Loaded';
	const signerBalance = loaded ? balances.signer : undefined;

	const native = (value: bigint) =>
		`${formatBalance(value, decimals, 6)} ${symbol}`;

	// Credits when the chain says what an action costs, native currency
	// otherwise. Never both: two units for one balance is exactly the confusion
	// credits exist to remove.
	const denominate = (value: bigint) =>
		credits
			? `${formatCredits(toCredits(value, credits.creditUnit))} credits`
			: native(value);

	// Exactly zero, deliberately. A signer with dust in it may still be unable to
	// afford the next transaction, but saying so needs a gas price and a specific
	// transaction to price - which is `balanceCheck`'s job, and a second opinion
	// here would be a second source of truth about affordability. Empty is the
	// one claim this store can make on its own, and it is also the state the user
	// is actually in: a signer nobody has funded yet.
	const needsFunding = signerBalance === 0n;

	// The top bar has room for one more figure, so spend it on information the
	// user does not already have. When the signer IS the payer, the balance shown
	// up there is already the signer's, and repeating it would just be the same
	// number twice; the one thing worth adding is the alarm when it hits zero,
	// which otherwise reads as an unremarkable "0".
	//
	// Credits are the exception: they are a DIFFERENT reading of that balance
	// (moves left, not currency held), so they earn their place next to it even
	// when both come from the same address.
	const showTopBarIndicator =
		loaded && (!signerIsSpender || needsFunding || !!credits);

	return {
		visible: true,
		denominatedInCredits: !!credits,
		label: labelFor(signerIsSpender),
		description: describe(signerIsSpender),
		signerAddress: signer.address,
		ownerAddress: signer.owner,
		signerText: signerBalance === undefined ? null : denominate(signerBalance),
		showSignerBalance: !signerIsSpender || !!credits,
		ownerText: loaded ? native(balances.owner) : null,
		showOwnerBalance: signerIsSpender,
		needsFunding,
		showTopBarIndicator,
		topBarText:
			signerBalance === undefined
				? ''
				: needsFunding
					? credits
						? 'No credits'
						: 'Needs funds'
					: denominate(signerBalance),
		topUpLabel: credits
			? `Get ${credits.creditsPerTopUp} credits`
			: `Add ${symbol}`,
		topUpNeedsAmount: !credits,
	};
}

/**
 * Read the signer out of a connection snapshot.
 *
 * A signer only exists at step 'SignedIn' (hosted sign-in derives it); every
 * other step, and every wallet-only deployment, yields undefined.
 */
export function signerAccountOf(
	$connection: Connection<UnderlyingEthereumProvider>,
): SignerAccount | undefined {
	if ($connection.step !== 'SignedIn') return undefined;
	return {
		address: $connection.account.signer.address,
		owner: $connection.account.address,
		// Same test the executor uses: SignedIn is reachable without a wallet
		// (email/social).
		ownerHasWallet: 'wallet' in $connection && !!$connection.wallet,
	};
}

export type CreditsViewStore = Readable<CreditsView>;

/**
 * Bind the view above to the app's stores.
 *
 * Subscribing to the returned store is what starts the signer-balance poll (the
 * poller runs only while it has subscribers), so a page that never shows the
 * signer never polls for it.
 */
export function createCreditsViewStore(
	params: Pick<Context, 'connection' | 'signerBalance' | 'deployments'> & {
		signerIsSpender: boolean;
		credits: CreditsConfig | undefined;
	},
): CreditsViewStore {
	const {connection, signerBalance, deployments} = params;

	return derived(
		[connection, signerBalance, deployments],
		([$connection, $balances, $deployments]) =>
			deriveCreditsView({
				signer: signerAccountOf($connection),
				balances: $balances,
				credits: params.credits,
				signerIsSpender: params.signerIsSpender,
				symbol: $deployments.chain.nativeCurrency.symbol,
				decimals: $deployments.chain.nativeCurrency.decimals,
			}),
	);
}
