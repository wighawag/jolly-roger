import {describe, it, expect} from 'vitest';
import {
	createBlockExplorer,
	resolveLinkTo,
	type ExplorerChainInfo,
} from '$lib/core/utils/ethereum/blockExplorer';

const etherscan: ExplorerChainInfo = {
	blockExplorers: {default: {name: 'Etherscan', url: 'https://etherscan.io'}},
};
const none: ExplorerChainInfo = {};

const HASH = '0xabcdef';
const ADDRESS = '0x1234';

describe('createBlockExplorer', () => {
	it("builds the chain's explorer urls and name", () => {
		const explorer = createBlockExplorer({
			chain: () => etherscan,
			internal: () => false,
		});
		expect(explorer.txUrl(HASH)).toBe('https://etherscan.io/tx/0xabcdef');
		expect(explorer.addressUrl(ADDRESS)).toBe(
			'https://etherscan.io/address/0x1234',
		);
		expect(explorer.name()).toBe('Etherscan');
		expect(explorer.external()).toBe(true);
		expect(explorer.internal()).toBe(false);
	});

	it('answers null when the chain names no explorer', () => {
		const explorer = createBlockExplorer({
			chain: () => none,
			internal: () => true,
		});
		expect(explorer.txUrl(HASH)).toBeNull();
		expect(explorer.addressUrl(ADDRESS)).toBeNull();
		expect(explorer.name()).toBeNull();
		expect(explorer.external()).toBe(false);
		expect(explorer.internal()).toBe(true);
	});

	it('reads the chain at call time, not when created', () => {
		let chain = none;
		const explorer = createBlockExplorer({
			chain: () => chain,
			internal: () => false,
		});
		expect(explorer.txUrl(HASH)).toBeNull();
		chain = etherscan;
		expect(explorer.txUrl(HASH)).toBe('https://etherscan.io/tx/0xabcdef');
	});
});

describe('resolveLinkTo', () => {
	const both = createBlockExplorer({
		chain: () => etherscan,
		internal: () => true,
	});
	const internalOnly = createBlockExplorer({
		chain: () => none,
		internal: () => true,
	});
	const externalOnly = createBlockExplorer({
		chain: () => etherscan,
		internal: () => false,
	});
	const neither = createBlockExplorer({
		chain: () => none,
		internal: () => false,
	});

	it('resolves auto from what the explorer offers', () => {
		expect(resolveLinkTo('auto', both)).toBe('both');
		expect(resolveLinkTo('auto', internalOnly)).toBe('internal');
		expect(resolveLinkTo('auto', externalOnly)).toBe('external');
		expect(resolveLinkTo('auto', neither)).toBe(false);
	});

	it('resolves auto to no link when no explorer is given', () => {
		expect(resolveLinkTo('auto')).toBe(false);
		expect(resolveLinkTo('auto', undefined)).toBe(false);
	});

	it('passes an explicit choice through, with or without an explorer', () => {
		for (const linkTo of ['internal', 'external', 'both', false] as const) {
			expect(resolveLinkTo(linkTo)).toBe(linkTo);
			expect(resolveLinkTo(linkTo, neither)).toBe(linkTo);
		}
	});
});
