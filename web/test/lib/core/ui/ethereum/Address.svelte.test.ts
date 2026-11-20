import {describe, it, expect} from 'vitest';
import {render} from 'vitest-browser-svelte';

import Address from '$lib/core/ui/ethereum/Address.svelte';
import {createBlockExplorer} from '$lib/core/utils/ethereum/blockExplorer';
import WithBlockExplorer from './WithBlockExplorer.svelte';

const etherscan = {
	blockExplorers: {default: {name: 'Etherscan', url: 'https://etherscan.io'}},
};

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

describe('Address.svelte', () => {
	it('truncates the address by default (0x + 4 ... 4)', async () => {
		const screen = await render(Address, {value: ADDRESS});
		await expect.element(screen.getByText('0x1234...5678')).toBeInTheDocument();
	});

	it('honours a custom truncate window', async () => {
		const screen = await render(Address, {
			value: ADDRESS,
			truncate: {start: 6, end: 6},
		});
		await expect
			.element(screen.getByText('0x123456...345678'))
			.toBeInTheDocument();
	});

	it('shows the full address when truncate is false', async () => {
		const screen = await render(Address, {value: ADDRESS, truncate: false});
		await expect.element(screen.getByText(ADDRESS)).toBeInTheDocument();
	});

	it('renders a copy button by default', async () => {
		const screen = await render(Address, {value: ADDRESS});
		await expect
			.element(screen.getByRole('button', {name: /copy address/i}))
			.toBeInTheDocument();
	});

	it('omits the copy button when showCopy is false', async () => {
		const screen = await render(Address, {value: ADDRESS, showCopy: false});
		await expect
			.element(screen.getByRole('button', {name: /copy address/i}))
			.not.toBeInTheDocument();
	});

	it('renders plain text (no link) when linkTo is false', async () => {
		const screen = await render(Address, {value: ADDRESS, linkTo: false});
		// The display text lives in a span, not an anchor.
		await expect.element(screen.getByText('0x1234...5678')).toBeInTheDocument();
		await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	});

	it('links to the internal explorer when linkTo is "internal"', async () => {
		const screen = await render(Address, {value: ADDRESS, linkTo: 'internal'});
		const link = screen.getByRole('link');
		await expect.element(link).toBeInTheDocument();
		await expect
			.element(link)
			.toHaveAttribute(
				'href',
				expect.stringContaining(`/explorer/address/${ADDRESS}`),
			);
	});

	it('re-truncates when the value prop changes', async () => {
		const screen = await render(Address, {value: ADDRESS});
		await expect.element(screen.getByText('0x1234...5678')).toBeInTheDocument();

		const other = '0xabcdef0000000000000000000000000000009999';
		await screen.rerender({value: other});
		await expect.element(screen.getByText('0xabcd...9999')).toBeInTheDocument();
	});

	it('renders no link for linkTo "auto" when no block explorer is provided', async () => {
		const screen = await render(Address, {value: ADDRESS, linkTo: 'auto'});
		await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	});

	it('links internally and to the provided explorer for linkTo "auto"', async () => {
		const screen = await render(WithBlockExplorer, {
			explorer: createBlockExplorer({
				chain: () => etherscan,
				internal: () => true,
			}),
			component: Address,
			innerProps: {value: ADDRESS, linkTo: 'auto'},
		});
		const links = screen.getByRole('link');
		await expect
			.element(links.first())
			.toHaveAttribute(
				'href',
				expect.stringContaining(`/explorer/address/${ADDRESS}`),
			);
		await expect
			.element(links.last())
			.toHaveAttribute('href', `https://etherscan.io/address/${ADDRESS}`);
	});

	it('links the text to the provided explorer when there is no internal one', async () => {
		const screen = await render(WithBlockExplorer, {
			explorer: createBlockExplorer({
				chain: () => etherscan,
				internal: () => false,
			}),
			component: Address,
			innerProps: {value: ADDRESS, linkTo: 'auto'},
		});
		const link = screen.getByRole('link');
		await expect
			.element(link)
			.toHaveAttribute('href', `https://etherscan.io/address/${ADDRESS}`);
	});
});
