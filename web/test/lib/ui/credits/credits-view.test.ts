import {describe, it, expect} from 'vitest';
import {
	deriveCreditsView,
	signerAccountOf,
	type CreditsViewInput,
	type SignerAccount,
} from '$lib/ui/credits/credits-view';
import type {CreditsConfig} from '$lib/core/connection/credits';
import type {BalanceValue} from '$lib/core/connection/balance';
import type {Connection, UnderlyingEthereumProvider} from '@etherplay/connect';

const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const ACCOUNT = '0x0000000000000000000000000000000000000001' as const;

/** 0.0001 ETH per credit (1 gwei worst gas price x 100k gas per action). */
const CREDITS: CreditsConfig = {
	creditUnit: 1_000_000_000n * 100_000n,
	creditsPerTopUp: 100,
};

const signerAccount: SignerAccount = {address: SIGNER, account: ACCOUNT};

function loaded(value: bigint): BalanceValue {
	return {step: 'Loaded', value};
}

function view(overrides: Partial<CreditsViewInput> = {}) {
	return deriveCreditsView({
		signer: signerAccount,
		balance: loaded(CREDITS.creditUnit * 12n),
		credits: undefined,
		symbol: 'ETH',
		decimals: 18,
		...overrides,
	});
}

describe('deriveCreditsView: visibility', () => {
	it('hides everything when there is no signer', () => {
		// An app whose TARGET_STEP is 'WalletConnected' never has one, and neither
		// does any app before sign-in. The section stays out of the DOM rather
		// than rendering an empty shell.
		const v = view({signer: undefined});
		expect(v.visible).toBe(false);
		expect(v.showTopBarIndicator).toBe(false);
		expect(v.signerAddress).toBe(undefined);
	});

	it('shows the section as soon as a signer exists, before its balance loads', () => {
		const v = view({balance: {step: 'Unloaded'}});
		expect(v.visible).toBe(true);
		expect(v.signerAddress).toBe(SIGNER);
		// No figure yet: the component renders a spinner, not a "0".
		expect(v.signerText).toBe(null);
		expect(v.needsFunding).toBe(false);
	});
});

describe('deriveCreditsView: denomination', () => {
	it('shows native currency when the chain does not price an action', () => {
		const v = view({balance: loaded(2n * 10n ** 18n)});
		expect(v.denominatedInCredits).toBe(false);
		expect(v.signerText).toBe('2 ETH');
	});

	it('shows credits when the chain prices an action', () => {
		const v = view({
			credits: CREDITS,
			balance: loaded(CREDITS.creditUnit * 12n),
		});
		expect(v.denominatedInCredits).toBe(true);
		expect(v.signerText).toBe('12 credits');
	});
});

describe('deriveCreditsView: the empty signer', () => {
	it('flags exactly zero as needing funding', () => {
		expect(view({balance: loaded(0n)}).needsFunding).toBe(true);
	});

	it('does not flag a low-but-nonzero balance', () => {
		// Whether dust covers the NEXT transaction needs a gas price and a specific
		// transaction to price: that is balanceCheck's job, and a second opinion
		// here would be a second source of truth about affordability.
		expect(view({balance: loaded(1n)}).needsFunding).toBe(false);
	});

	it('says something to act on rather than a neutral zero', () => {
		expect(view({balance: loaded(0n)}).topBarText).toBe('Needs funds');
		expect(view({credits: CREDITS, balance: loaded(0n)}).topBarText).toBe(
			'No credits',
		);
	});
});

describe('deriveCreditsView: the top bar', () => {
	it('shows the signer once its balance is known', () => {
		// Never a repeat of the figure beside it: that one is the user's OWN
		// account, so this is always a different address.
		const v = view({balance: loaded(10n ** 18n)});
		expect(v.showTopBarIndicator).toBe(true);
		expect(v.topBarText).toBe('1 ETH');
	});

	it('stays out until the balance is known', () => {
		// Otherwise it flashes "needs funds" on every page load, before the first
		// poll has said anything.
		expect(view({balance: {step: 'Unloaded'}}).showTopBarIndicator).toBe(false);
	});

	it('shows credits there when the chain prices an action', () => {
		const v = view({
			credits: CREDITS,
			balance: loaded(CREDITS.creditUnit * 7n),
		});
		expect(v.topBarText).toBe('7 credits');
	});
});

describe('deriveCreditsView: the top-up offer', () => {
	it('names the action without an amount, whatever the denomination', () => {
		// The label no longer carries an amount: how much a top-up is worth is
		// decided per payer, at the moment of paying (see top-up-flow), so naming a
		// figure here would promise one the payer may not be able to send.
		expect(view({credits: CREDITS}).topUpLabel).toBe('Get credits');
		expect(view({credits: undefined}).topUpLabel).toBe('Top up');
		expect(view({credits: CREDITS}).topUpLabel).not.toMatch(/\d/);
	});

	it('offers the top-up whether or not the signer is empty', () => {
		// Unlike a faucet, buying credits is a normal thing to do at any balance: a
		// player topping up before they run out should not have to run out first.
		expect(view({balance: loaded(10n ** 18n)}).visible).toBe(true);
		expect(view({balance: loaded(0n)}).visible).toBe(true);
	});
});

describe('deriveCreditsView: naming', () => {
	it('names the signer for its role, not for what it is', () => {
		expect(view().label).toBe('In-app balance');
	});

	it('calls the row what it holds once the chain prices actions', () => {
		expect(view({credits: CREDITS}).label).toBe('Credits');
	});

	it('never uses the word "signer" in anything the user reads', () => {
		const v = view({credits: CREDITS});
		const userFacing = [
			v.label,
			v.description,
			v.topBarText,
			v.topUpLabel,
		].join(' ');
		expect(userFacing.toLowerCase()).not.toContain('signer');
	});
});

describe('signerAccountOf', () => {
	function connection(value: unknown) {
		return value as Connection<UnderlyingEthereumProvider>;
	}

	it('reads the signer and the account it belongs to once signed in', () => {
		const account = signerAccountOf(
			connection({
				step: 'SignedIn',
				account: {address: ACCOUNT, signer: {address: SIGNER}},
				wallet: {accounts: [ACCOUNT]},
			}),
		);
		expect(account).toEqual({address: SIGNER, account: ACCOUNT});
	});

	it('finds the signer for an email/social sign-in too', () => {
		// No wallet behind the account, but still a signer. That is precisely the
		// case the signer exists for: the app can act even when the user cannot
		// sign anything themselves.
		const account = signerAccountOf(
			connection({
				step: 'SignedIn',
				account: {address: ACCOUNT, signer: {address: SIGNER}},
				wallet: undefined,
			}),
		);
		expect(account).toEqual({address: SIGNER, account: ACCOUNT});
	});

	it.each(['Idle', 'WalletConnected', 'WaitingForSignature'])(
		'yields nothing at step %s',
		(step) => {
			expect(
				signerAccountOf(connection({step, account: {address: ACCOUNT}})),
			).toBe(undefined);
		},
	);
});
