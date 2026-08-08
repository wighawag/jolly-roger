import {derived, type Readable} from 'svelte/store';
import type {Connection, UnderlyingEthereumProvider} from '@etherplay/connect';
import {formatBalance} from '$lib/core/utils/format/balance';
import {
	formatCredits,
	toCredits,
	type CreditsConfig,
} from '$lib/core/connection/credits';
import type {BalanceValue} from '$lib/core/connection/balance';
import type {Context} from '$lib/context/types';

/** Who the signer is, and which account it belongs to. */
export type SignerAccount = {
	address: `0x${string}`;
	account: `0x${string}`;
};

export type CreditsViewInput = {
	/** Undefined until a signer exists (i.e. until the connection is SignedIn). */
	signer: SignerAccount | undefined;
	/** Latest value of the signer-balance poller. */
	balance: BalanceValue;
	/** Credits denomination, or undefined to show native currency. */
	credits: CreditsConfig | undefined;
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
	/** The signer's balance, in whichever unit is being shown; null until loaded. */
	signerText: string | null;
	/** The signer holds nothing and cannot pay for a single action. */
	needsFunding: boolean;
	/** Whether the compact top-bar indicator renders. */
	showTopBarIndicator: boolean;
	/** Text for that indicator. */
	topBarText: string;
	/** Label for the action that funds the signer. */
	topUpLabel: string;
};

const HIDDEN: CreditsView = {
	visible: false,
	denominatedInCredits: false,
	label: '',
	description: '',
	signerAddress: undefined,
	signerText: null,
	needsFunding: false,
	showTopBarIndicator: false,
	topBarText: '',
	topUpLabel: '',
};

/**
 * Naming. "Signer" is an implementation word: it means a private key this
 * browser holds, which a player has no reason to know about. What they can act
 * on is which account pays for what, so it is named for its ROLE.
 *
 * Short, because this is now a balance ROW sitting above the user's own account
 * rather than a titled panel explaining itself. What it is stays available as
 * the description, on hover; what it is FOR is the number next to it. When the
 * chain prices actions the row is simply called what it holds.
 */
const LABEL_CREDITS = 'Credits';
const LABEL_NATIVE = 'In-app balance';
const DESCRIPTION =
	'Held in this browser so the app can act on your behalf without asking you to sign every time. Separate from your account, and funded separately.';

/**
 * Name for the action that funds the signer.
 *
 * No amount in it, because the amount is no longer fixed: the flow works out
 * what this payer can actually send (see ./top-up-flow). Exported so the button
 * that opens the flow and the modal that runs it cannot drift apart, which they
 * did: the panel said "Top up" and the modal it opened was titled "Get credits".
 */
export function topUpActionLabel(credits: CreditsConfig | undefined): string {
	return credits ? 'Get credits' : 'Top up';
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
	const {signer, balance, credits, symbol, decimals} = input;

	// No signer: wallet-only deployments, and every step before sign-in. Nothing
	// here has an address to talk about, so the whole section stays out of the
	// DOM rather than rendering an empty shell.
	if (!signer) return HIDDEN;

	const signerBalance = balance.step === 'Loaded' ? balance.value : undefined;

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

	// Shown as soon as the balance is known, and not before: the top bar's other
	// figure is the user's OWN account, so this is always a different address and
	// never a repeat. Waiting for the load stops it flashing "needs funds" on
	// every page load, before the first poll has said anything.
	const showTopBarIndicator = signerBalance !== undefined;

	return {
		visible: true,
		denominatedInCredits: !!credits,
		label: credits ? LABEL_CREDITS : LABEL_NATIVE,
		description: DESCRIPTION,
		signerAddress: signer.address,
		signerText: signerBalance === undefined ? null : denominate(signerBalance),
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
		topUpLabel: topUpActionLabel(credits),
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
		account: $connection.account.address,
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
		credits: CreditsConfig | undefined;
	},
): CreditsViewStore {
	const {connection, signerBalance, deployments} = params;

	return derived(
		[connection, signerBalance, deployments],
		([$connection, $balance, $deployments]) =>
			deriveCreditsView({
				signer: signerAccountOf($connection),
				balance: $balance,
				credits: params.credits,
				symbol: $deployments.chain.nativeCurrency.symbol,
				decimals: $deployments.chain.nativeCurrency.decimals,
			}),
	);
}
