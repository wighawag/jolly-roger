import {describe, it, expect} from 'vitest';
import {resolveSignerRpc} from '../../../../src/lib/core/connection/signer-rpc';

describe('resolveSignerRpc', () => {
	describe('wallet mode', () => {
		it('is ok with no RPC at all (wallet provides one)', () => {
			const r = resolveSignerRpc('wallet', undefined, [], true);
			expect(r).toEqual({ok: true, rpcUrl: undefined});
		});

		it('still reports a resolved url when one is available', () => {
			const r = resolveSignerRpc('wallet', 'https://node.example', [], true);
			expect(r).toEqual({ok: true, rpcUrl: 'https://node.example'});
		});
	});

	describe('signer mode', () => {
		it('accepts an explicit PUBLIC_NODE_URL', () => {
			const r = resolveSignerRpc('signer', 'https://node.example', [], true);
			expect(r).toEqual({ok: true, rpcUrl: 'https://node.example'});
		});

		it('accepts a chain rpcUrl when PUBLIC_NODE_URL is absent (Q2b)', () => {
			const r = resolveSignerRpc('signer', undefined, ['https://chain-rpc.example'], true);
			expect(r).toEqual({ok: true, rpcUrl: 'https://chain-rpc.example'});
		});

		it('prefers PUBLIC_NODE_URL over the chain rpcUrl', () => {
			const r = resolveSignerRpc('signer', 'https://explicit.example', ['https://chain-rpc.example'], true);
			expect(r.ok && r.rpcUrl).toBe('https://explicit.example');
		});

		it('trims and ignores whitespace-only urls', () => {
			expect(resolveSignerRpc('signer', '  ', ['  ', 'https://chain.example'], true).ok).toBe(true);
			expect(resolveSignerRpc('signer', '  https://x.example ', [], true)).toEqual({
				ok: true,
				rpcUrl: 'https://x.example',
			});
		});

		it('fails when no RPC is configured anywhere', () => {
			const r = resolveSignerRpc('signer', undefined, [], true);
			expect(r.ok).toBe(false);
		});

		it('gives a developer-facing message in dev', () => {
			const r = resolveSignerRpc('signer', '', undefined, true);
			expect(r.ok).toBe(false);
			expect(!r.ok && r.error).toMatch(/PUBLIC_NODE_URL/);
			expect(!r.ok && r.error).toMatch(/signer/i);
		});

		it('gives a user-facing message in production', () => {
			const r = resolveSignerRpc('signer', '', undefined, false);
			expect(r.ok).toBe(false);
			expect(!r.ok && r.error).toMatch(/contact the site operator/i);
			// must not leak env-var config guidance to end users
			expect(!r.ok && r.error).not.toMatch(/PUBLIC_NODE_URL/);
		});
	});
});
