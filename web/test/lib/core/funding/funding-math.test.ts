import {describe, it, expect} from 'vitest';
import {
	checkPayerFunds,
	formatAmount,
	gasReserve,
	offerAmount,
	reconcileBalance,
	spendableBalance,
	TRANSFER_GAS,
} from '$lib/core/funding';

/**
 * `core/funding` is an EXTENSION POINT PLACED UPSTREAM FOR A DESCENDANT, in the
 * same sense as `createPaymentRail` (see `core/connection/payment-rail.test.ts`
 * for the reasoning, which applies unchanged here).
 *
 * Nothing on this branch imports it yet. `with/local-signer` does, to size and
 * send a top-up; a game downstream of that does, to size and send a purchase
 * that also funds a signer. It lives here because none of it depends on there
 * being a local signer, and because the alternative is what actually happened:
 * a descendant re-derived the payer rule, the gas reserve and the stale-balance
 * rule from scratch, the third of them from a bug report.
 *
 * So these tests are the thing that lets THIS branch know when it has broken
 * them. Without them a change here leaves main green and surfaces during a
 * cascade, which is the worst possible moment to be debugging fee arithmetic.
 *
 * They are unit tests of pure functions and nothing more. What happens when
 * these figures reach a wallet is tested on the branch that has a wallet.
 */

const GWEI = 1_000_000_000n;
const ETH = 10n ** 18n;
/** 21000 gas at 1 gwei, doubled: the reserve carries a safety multiplier
 * because the WALLET picks the fee, not us. */
const TRANSFER_COST = TRANSFER_GAS * GWEI * 2n;

describe('gasReserve: what the payer must keep back', () => {
	it('doubles the estimate, because the wallet picks the fee and not us', () => {
		expect(gasReserve(GWEI)).toBe(TRANSFER_GAS * GWEI * 2n);
	});

	it('prices the gas it is given, since a contract call is not a transfer', () => {
		expect(gasReserve(GWEI, 150_000n)).toBe(150_000n * GWEI * 2n);
	});
});

describe('spendableBalance: keeping back the gas of sending', () => {
	it('subtracts the cost of the transfer itself', () => {
		expect(spendableBalance({balance: ETH, maxFeePerGas: GWEI})).toBe(
			ETH - TRANSFER_COST,
		);
	});

	it('reports nothing spendable when the balance cannot even cover gas', () => {
		// Zero rather than negative: the question is "how much can be sent".
		expect(
			spendableBalance({balance: TRANSFER_COST - 1n, maxFeePerGas: GWEI}),
		).toBe(0n);
	});

	it('prices a caller-supplied gas limit, for a send that is a contract call', () => {
		expect(
			spendableBalance({balance: ETH, maxFeePerGas: GWEI, gas: 150_000n}),
		).toBe(ETH - 150_000n * GWEI * 2n);
	});
});

describe('offerAmount: what this payer will actually send', () => {
	it('sends the full price when the payer can afford it', () => {
		expect(
			offerAmount({balance: ETH, maxFeePerGas: GWEI, ceiling: ETH / 100n}),
		).toBe(ETH / 100n);
	});

	it('sends what is left after gas when the payer holds less than the price', () => {
		// THE RULE THAT MAKES A FAUCET ENOUGH: a freshly fauceted payer holds
		// exactly the faucet's amount, and this lands under it by the cost of the
		// transaction rather than attempting a price it cannot cover.
		const balance = ETH / 1000n;
		expect(
			offerAmount({balance, maxFeePerGas: GWEI, ceiling: ETH / 100n}),
		).toBe(balance - TRANSFER_COST);
	});

	it('sends nothing when the payer cannot cover the transaction at all', () => {
		expect(
			offerAmount({
				balance: TRANSFER_COST,
				maxFeePerGas: GWEI,
				ceiling: ETH,
			}),
		).toBe(0n);
	});
});

describe('reconcileBalance: a wallet that has not seen the money yet', () => {
	it('takes what we watched arrive over a chain read that is behind', () => {
		// An injected wallet answers eth_getBalance from a cache until it sees a
		// new block, so a read straight after a faucet claim reports the balance
		// from BEFORE the claim.
		expect(reconcileBalance({reported: 0n, knownToHold: ETH})).toEqual({
			balance: ETH,
			behind: true,
		});
	});

	it('says when it is ahead of the chain, rather than hiding it', () => {
		// The caller has to be able to warn: the transaction is fine to send, but
		// the wallet may refuse to sign until it catches up.
		expect(reconcileBalance({reported: 0n, knownToHold: ETH}).behind).toBe(
			true,
		);
	});

	it('lets the chain win when it knows more, since the payer may have held some', () => {
		expect(reconcileBalance({reported: ETH, knownToHold: ETH / 2n})).toEqual({
			balance: ETH,
			behind: false,
		});
	});

	it('is the plain read when nothing was watched arriving', () => {
		expect(reconcileBalance({reported: ETH})).toEqual({
			balance: ETH,
			behind: false,
		});
	});
});

describe('checkPayerFunds: asking the chain before asking the wallet', () => {
	it('passes when the balance covers the value and its gas', () => {
		expect(
			checkPayerFunds({balance: ETH, value: ETH / 2n, maxFeePerGas: GWEI}),
		).toEqual({ok: true});
	});

	it('refuses to send exactly the balance, which always fails', () => {
		const result = checkPayerFunds({
			balance: ETH,
			value: ETH,
			maxFeePerGas: GWEI,
		});
		expect(result.ok).toBe(false);
	});

	it('reports both figures, so the shortfall can be explained', () => {
		const result = checkPayerFunds({
			balance: 0n,
			value: ETH,
			maxFeePerGas: GWEI,
		});
		expect(result).toEqual({
			ok: false,
			balance: 0n,
			required: ETH + TRANSFER_GAS * GWEI,
		});
	});
});

describe('formatAmount', () => {
	it('rounds down, so a displayed figure never overstates what is sent', () => {
		expect(formatAmount(1_999_999_999_999_999_999n, 18)).toBe('1.999999');
	});
});
