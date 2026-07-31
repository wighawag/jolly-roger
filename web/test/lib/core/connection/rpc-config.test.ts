import {describe, it, expect} from 'vitest';
import {hasConfiguredRpc} from '../../../../src/lib/core/connection/rpc-config';

describe('hasConfiguredRpc', () => {
	it('is true when PUBLIC_NODE_URL is set', () => {
		expect(hasConfiguredRpc('https://node.example', [])).toBe(true);
	});

	it('is true when a chain rpcUrl is present', () => {
		expect(hasConfiguredRpc(undefined, ['https://chain.example'])).toBe(true);
	});

	it('is false when neither is set', () => {
		expect(hasConfiguredRpc(undefined, [])).toBe(false);
		expect(hasConfiguredRpc('', undefined)).toBe(false);
	});

	it('ignores whitespace-only values', () => {
		expect(hasConfiguredRpc('   ', ['  ', ''])).toBe(false);
		expect(hasConfiguredRpc('  ', ['  ', 'https://chain.example'])).toBe(true);
	});
});
