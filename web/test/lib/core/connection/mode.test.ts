import {describe, it, expect} from 'vitest';
import {
	resolveConnectionConfig,
	TARGET_STEP,
} from '../../../../src/lib/core/connection/mode';

describe('resolveConnectionConfig', () => {
	it('offers hosted mechanisms when a host is configured', () => {
		const c = resolveConnectionConfig('SignedIn', 'https://wallet.example');
		expect(c).toEqual({
			targetStep: 'SignedIn',
			walletHost: 'https://wallet.example',
			walletOnly: false,
		});
	});

	it('signs in with built-in wallets only when there is no host', () => {
		// The point of the split: a signer needs no backend. Sign-in still happens
		// (so there is still a local signer), it just cannot offer email or social,
		// which are popup flows served BY the host.
		const c = resolveConnectionConfig('SignedIn', undefined);
		expect(c).toEqual({
			targetStep: 'SignedIn',
			walletHost: undefined,
			walletOnly: true,
		});
	});

	it('leaves the target step alone: the host never decides it', () => {
		// The regression this guards: inferring "can this app have a signer" from
		// PUBLIC_WALLET_HOST. A hostless app can still sign in, and an app that
		// stops at WalletConnected has no signer even with a host configured.
		expect(
			resolveConnectionConfig('WalletConnected', undefined).targetStep,
		).toBe('WalletConnected');
		expect(
			resolveConnectionConfig('WalletConnected', 'https://wallet.example')
				.targetStep,
		).toBe('WalletConnected');
		expect(resolveConnectionConfig('SignedIn', undefined).targetStep).toBe(
			'SignedIn',
		);
	});

	it.each([undefined, '', '   '])(
		'treats a blank host (%p) as no host',
		(raw) => {
			const c = resolveConnectionConfig('SignedIn', raw);
			expect(c.walletHost).toBe(undefined);
			expect(c.walletOnly).toBe(true);
		},
	);

	it('trims a configured host', () => {
		expect(
			resolveConnectionConfig('SignedIn', '  https://wallet.example  ')
				.walletHost,
		).toBe('https://wallet.example');
	});

	it('is total: every combination resolves', () => {
		// There is no illegal combination left to reject. The one that used to
		// exist (signer execution with no signer) went away with the execution
		// mode: call sites now name the executor they want, and one with no signer
		// behind it is simply never ready.
		for (const step of ['SignedIn', 'WalletConnected'] as const) {
			for (const host of [undefined, 'https://wallet.example']) {
				expect(resolveConnectionConfig(step, host).targetStep).toBe(step);
			}
		}
	});
});

describe('TARGET_STEP', () => {
	it('is a configured constant, not read from env', () => {
		// This branch signs in, because its whole point is having a local signer.
		// A descendant that does not want one changes this single line, and every
		// other decision follows from it.
		expect(TARGET_STEP).toBe('SignedIn');
	});
});
