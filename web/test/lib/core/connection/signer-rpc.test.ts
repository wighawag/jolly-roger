import {describe, it, expect} from 'vitest';
import {resolveSignerRpc} from '../../../../src/lib/core/connection/signer-rpc';

describe('resolveSignerRpc', () => {
	describe('an app with nothing that needs its own RPC', () => {
		it('is ok with no RPC at all (the wallet provides one)', () => {
			const r = resolveSignerRpc(
				{targetStep: 'WalletConnected', walletOnly: true},
				undefined,
				[],
				true,
			);
			expect(r).toEqual({ok: true, rpcUrl: undefined});
		});

		it('still reports a resolved url when one is available', () => {
			const r = resolveSignerRpc(
				{targetStep: 'WalletConnected', walletOnly: true},
				'https://node.example',
				[],
				true,
			);
			expect(r).toEqual({ok: true, rpcUrl: 'https://node.example'});
		});
	});

	describe('hosted sign-in, where an account may have no wallet', () => {
		it('accepts an explicit PUBLIC_NODE_URL', () => {
			const r = resolveSignerRpc(
				{targetStep: 'SignedIn', walletOnly: false},
				'https://node.example',
				[],
				true,
			);
			expect(r).toEqual({ok: true, rpcUrl: 'https://node.example'});
		});

		it('accepts a chain rpcUrl when PUBLIC_NODE_URL is absent (Q2b)', () => {
			const r = resolveSignerRpc(
				{targetStep: 'SignedIn', walletOnly: false},
				undefined,
				['https://chain-rpc.example'],
				true,
			);
			expect(r).toEqual({ok: true, rpcUrl: 'https://chain-rpc.example'});
		});

		it('prefers PUBLIC_NODE_URL over the chain rpcUrl', () => {
			const r = resolveSignerRpc(
				{targetStep: 'SignedIn', walletOnly: false},
				'https://explicit.example',
				['https://chain-rpc.example'],
				true,
			);
			expect(r.ok && r.rpcUrl).toBe('https://explicit.example');
		});

		it('trims and ignores whitespace-only urls', () => {
			expect(
				resolveSignerRpc(
					{targetStep: 'SignedIn', walletOnly: false},
					'  ',
					['  ', 'https://chain.example'],
					true,
				).ok,
			).toBe(true);
			expect(
				resolveSignerRpc(
					{targetStep: 'SignedIn', walletOnly: false},
					'  https://x.example ',
					[],
					true,
				),
			).toEqual({
				ok: true,
				rpcUrl: 'https://x.example',
			});
		});

		it('fails when no RPC is configured anywhere', () => {
			const r = resolveSignerRpc(
				{targetStep: 'SignedIn', walletOnly: false},
				undefined,
				[],
				true,
			);
			expect(r.ok).toBe(false);
		});

		it('gives a developer-facing message in dev', () => {
			const r = resolveSignerRpc(
				{targetStep: 'SignedIn', walletOnly: false},
				'',
				undefined,
				true,
			);
			expect(r.ok).toBe(false);
			expect(!r.ok && r.error).toMatch(/PUBLIC_NODE_URL/);
			expect(!r.ok && r.error).toMatch(/signer/i);
		});

		it('gives a user-facing message in production', () => {
			const r = resolveSignerRpc(
				{targetStep: 'SignedIn', walletOnly: false},
				'',
				undefined,
				false,
			);
			expect(r.ok).toBe(false);
			expect(!r.ok && r.error).toMatch(/contact the site operator/i);
			// must not leak env-var config guidance to end users
			expect(!r.ok && r.error).not.toMatch(/PUBLIC_NODE_URL/);
		});
	});
});
