import {describe, it, expect} from 'vitest';
import {
	deriveCreditsView,
	signerAccountOf,
	type CreditsViewInput,
	type SignerAccount,
} from '$lib/ui/credits/credits-view';
import type {CreditsConfig} from '$lib/core/connection/credits';
import type {SignerBalanceValue} from '$lib/core/connection/signerBalance';
import type {Connection, UnderlyingEthereumProvider} from '@etherplay/connect';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const OWNER = '0x0000000000000000000000000000000000000001' as const;

/** 0.0001 ETH per credit (1 gwei worst gas price x 100k gas per action). */
const CREDITS: CreditsConfig = {
	creditUnit: 1_000_000_000n * 100_000n,
	creditsPerTopUp: 100,
};

const signerAccount: SignerAccount = {
	address: SIGNER,
	owner: OWNER,
	ownerHasWallet: true,
};

function loaded(signer: bigint, owner = 5n * 10n ** 18n): SignerBalanceValue {
	return {step: 'Loaded', signer, owner};
}

function view(overrides: Partial<CreditsViewInput> = {}) {
	return deriveCreditsView({
		signer: signerAccount,
		balances: loaded(CREDITS.creditUnit * 12n),
		credits: undefined,
		signerIsSpender: false,
		symbol: 'ETH',
		decimals: 18,
		...overrides,
	});
}

describe('deriveCreditsView: visibility', () => {
	it('hides everything when there is no signer', () => {
		// Wallet-only deployments and every step before sign-in land here. The
		// section must stay out of the DOM rather than render an empty shell.
		const v = view({signer: undefined});
		expect(v.visible).toBe(false);
		expect(v.showTopBarIndicator).toBe(false);
		expect(v.signerAddress).toBe(undefined);
	});

	it('shows the section as soon as a signer exists, before its balance loads', () => {
		const v = view({balances: {step: 'Unloaded'}});
		expect(v.visible).toBe(true);
		expect(v.signerAddress).toBe(SIGNER);
		// No figure to show yet: the component renders a spinner, not a "0".
		expect(v.signerText).toBe(null);
		expect(v.needsFunding).toBe(false);
	});

	it('keeps the top-bar indicator out until the balance is known', () => {
		// Otherwise it would flash "Needs funds" at every reload, before the first
		// poll has said anything.
		expect(view({balances: {step: 'Unloaded'}}).showTopBarIndicator).toBe(
			false,
		);
	});
});

describe('deriveCreditsView: denomination', () => {
	it('shows native currency when the chain does not price an action', () => {
		const v = view({balances: loaded(2n * 10n ** 18n)});
		expect(v.denominatedInCredits).toBe(false);
		expect(v.signerText).toBe('2 ETH');
	});

	it('shows credits when the chain prices an action', () => {
		const v = view({
			credits: CREDITS,
			balances: loaded(CREDITS.creditUnit * 12n),
		});
		expect(v.denominatedInCredits).toBe(true);
		expect(v.signerText).toBe('12 credits');
	});

	it('keeps the owner in native currency even in credits mode', () => {
		// Credits are the signer's fuel gauge. The owner's balance is money, and
		// denominating it in the signer's action cost would be meaningless.
		const v = view({
			credits: CREDITS,
			balances: loaded(CREDITS.creditUnit, 3n * 10n ** 18n),
		});
		expect(v.ownerText).toBe('3 ETH');
	});
});

describe('deriveCreditsView: the empty signer', () => {
	it('flags exactly zero as needing funding', () => {
		expect(view({balances: loaded(0n)}).needsFunding).toBe(true);
	});

	it('does not flag a low-but-nonzero balance', () => {
		// Whether dust covers the NEXT transaction needs a gas price and a specific
		// transaction to price: that is balanceCheck's job, and a second opinion
		// here would be a second source of truth about affordability.
		expect(view({balances: loaded(1n)}).needsFunding).toBe(false);
	});

	it('says something to act on rather than a neutral zero', () => {
		expect(view({balances: loaded(0n)}).topBarText).toBe('Needs funds');
		expect(view({credits: CREDITS, balances: loaded(0n)}).topBarText).toBe(
			'No credits',
		);
	});
});

describe('deriveCreditsView: what the top bar is worth showing', () => {
	it('shows the signer when the wallet is the one paying', () => {
		// Wallet execution mode: the top bar balance is the wallet's, so the
		// signer's is genuinely new information.
		const v = view({signerIsSpender: false, balances: loaded(10n ** 18n)});
		expect(v.showTopBarIndicator).toBe(true);
		expect(v.topBarText).toBe('1 ETH');
	});

	it('does not repeat the same figure when the signer IS the payer', () => {
		// Signer execution mode with no credits configured: the top bar already
		// shows this exact balance, in this exact unit.
		const v = view({signerIsSpender: true, balances: loaded(10n ** 18n)});
		expect(v.showTopBarIndicator).toBe(false);
	});

	it('still raises the alarm when the payer-signer is empty', () => {
		// "0 ETH" next to the balance reads as unremarkable; this is the whole
		// point of the feature.
		const v = view({signerIsSpender: true, balances: loaded(0n)});
		expect(v.showTopBarIndicator).toBe(true);
		expect(v.topBarText).toBe('Needs funds');
	});

	it('shows credits next to the payer-signer balance, being a different reading', () => {
		const v = view({
			signerIsSpender: true,
			credits: CREDITS,
			balances: loaded(CREDITS.creditUnit * 7n),
		});
		expect(v.showTopBarIndicator).toBe(true);
		expect(v.topBarText).toBe('7 credits');
	});
});

describe('deriveCreditsView: what the panel repeats', () => {
	it('omits the signer figure when the panel already shows it as the spending balance', () => {
		expect(view({signerIsSpender: true}).showSignerBalance).toBe(false);
	});

	it('shows it in credits mode, which is a different unit from the one above', () => {
		expect(
			view({signerIsSpender: true, credits: CREDITS}).showSignerBalance,
		).toBe(true);
	});

	it('shows it whenever the wallet is the spender', () => {
		expect(view({signerIsSpender: false}).showSignerBalance).toBe(true);
	});

	it('shows the owner only when the spending balance is not already the owner’s', () => {
		expect(view({signerIsSpender: true}).showOwnerBalance).toBe(true);
		expect(view({signerIsSpender: false}).showOwnerBalance).toBe(false);
	});
});

describe('deriveCreditsView: the top-up offer', () => {
	it('names a fixed price when credits are configured, and asks for no amount', () => {
		const v = view({credits: CREDITS});
		expect(v.topUpLabel).toBe('Get 100 credits');
		expect(v.topUpNeedsAmount).toBe(false);
	});

	it('asks for an amount when there is no credit unit to price a top-up with', () => {
		const v = view({credits: undefined});
		expect(v.topUpLabel).toBe('Add ETH');
		expect(v.topUpNeedsAmount).toBe(true);
	});

	it('offers the top-up whether or not the signer is empty', () => {
		// Unlike the faucet, buying credits is a normal thing to do at any balance:
		// a player topping up before they run out should not have to run out first.
		expect(view({balances: loaded(10n ** 18n)}).visible).toBe(true);
		expect(view({balances: loaded(0n)}).visible).toBe(true);
	});
});

describe('deriveCreditsView: naming', () => {
	it('calls the signer the spending account when it is the one paying', () => {
		expect(view({signerIsSpender: true}).label).toBe('Spending account');
	});

	it('does not claim that name when the wallet is paying', () => {
		// Otherwise a failed wallet transaction would send the user to look at the
		// wrong balance.
		expect(view({signerIsSpender: false}).label).toBe(
			'In-app spending account',
		);
	});

	it('never uses the word "signer" in anything the user reads', () => {
		for (const signerIsSpender of [true, false]) {
			const v = view({signerIsSpender, credits: CREDITS});
			const userFacing = [
				v.label,
				v.description,
				v.topBarText,
				v.topUpLabel,
			].join(' ');
			expect(userFacing.toLowerCase()).not.toContain('signer');
		}
	});
});

describe('signerAccountOf', () => {
	function connection(value: unknown) {
		return value as Connection<UnderlyingEthereumProvider>;
	}

	it('reads the signer and its owner once signed in', () => {
		const account = signerAccountOf(
			connection({
				step: 'SignedIn',
				account: {address: OWNER, signer: {address: SIGNER}},
				wallet: {accounts: [OWNER]},
			}),
		);
		expect(account).toEqual({
			address: SIGNER,
			owner: OWNER,
			ownerHasWallet: true,
		});
	});

	it('reports no wallet for an email/social sign-in', () => {
		// Such an owner has an address but no key to sign a payment with.
		const account = signerAccountOf(
			connection({
				step: 'SignedIn',
				account: {address: OWNER, signer: {address: SIGNER}},
				wallet: undefined,
			}),
		);
		expect(account?.ownerHasWallet).toBe(false);
	});

	it.each(['Idle', 'WalletConnected', 'WaitingForSignature'])(
		'yields nothing at step %s',
		(step) => {
			expect(
				signerAccountOf(connection({step, account: {address: OWNER}})),
			).toBe(undefined);
		},
	);
});
