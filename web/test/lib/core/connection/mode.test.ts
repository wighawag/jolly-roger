import {describe, it, expect} from 'vitest';
import {
	resolveConnectionConfig,
	TARGET_STEP,
} from '../../../../src/lib/core/connection/mode';

describe('TARGET_STEP', () => {
	/**
	 * Not a tautology. This template is the wallet-connected one: the account
	 * sends its own transactions, and nothing here spends from a derived signer.
	 * Flipping the constant is a deliberate act that also needs the executor and
	 * funding UI from the signer variant, so it should not happen by accident in
	 * a merge.
	 */
	it('is WalletConnected on this branch', () => {
		expect(TARGET_STEP).toBe('WalletConnected');
	});
});

describe('resolveConnectionConfig', () => {
	it('offers no hosted mechanisms without a host', () => {
		expect(resolveConnectionConfig('WalletConnected', undefined)).toEqual({
			targetStep: 'WalletConnected',
			walletHost: undefined,
			walletOnly: true,
		});
	});

	it('offers hosted mechanisms when a host is configured', () => {
		expect(
			resolveConnectionConfig('SignedIn', 'https://wallet.example'),
		).toEqual({
			targetStep: 'SignedIn',
			walletHost: 'https://wallet.example',
			walletOnly: false,
		});
	});

	/**
	 * The host decides which MECHANISMS exist, never how far the connection
	 * goes. Reading the two apart is the whole point of the split, and testing
	 * both crossings is what stops them being quietly recombined.
	 */
	it('keeps the target step independent of the host', () => {
		expect(
			resolveConnectionConfig('WalletConnected', 'https://wallet.example'),
		).toMatchObject({targetStep: 'WalletConnected', walletOnly: false});

		expect(resolveConnectionConfig('SignedIn', undefined)).toMatchObject({
			targetStep: 'SignedIn',
			walletOnly: true,
		});
	});

	it('treats a blank host as no host', () => {
		expect(resolveConnectionConfig('WalletConnected', '   ')).toEqual({
			targetStep: 'WalletConnected',
			walletHost: undefined,
			walletOnly: true,
		});
	});

	it('trims a configured host', () => {
		expect(
			resolveConnectionConfig('WalletConnected', '  https://x.example  '),
		).toMatchObject({walletHost: 'https://x.example'});
	});
});
