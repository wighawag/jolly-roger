import {describe, it, expect} from 'vitest';
import {render} from 'vitest-browser-svelte';

import TransactionHash from '$lib/core/ui/ethereum/TransactionHash.svelte';
import {createBlockExplorer} from '$lib/core/utils/ethereum/blockExplorer';
import WithBlockExplorer from './WithBlockExplorer.svelte';

const etherscan = {
	blockExplorers: {default: {name: 'Etherscan', url: 'https://etherscan.io'}},
};

const HASH =
	'0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('TransactionHash.svelte', () => {
	it('truncates the hash by default (0x + 6 ... 4)', async () => {
		const screen = await render(TransactionHash, {value: HASH});
		await expect
			.element(screen.getByText('0xabcdef...6789'))
			.toBeInTheDocument();
	});

	it('shows the full hash when truncate is false', async () => {
		const screen = await render(TransactionHash, {
			value: HASH,
			truncate: false,
		});
		await expect.element(screen.getByText(HASH)).toBeInTheDocument();
	});

	it('renders a copy button by default', async () => {
		const screen = await render(TransactionHash, {value: HASH});
		await expect
			.element(screen.getByRole('button', {name: /copy transaction hash/i}))
			.toBeInTheDocument();
	});

	it('renders plain text (no link) when linkTo is false', async () => {
		const screen = await render(TransactionHash, {value: HASH, linkTo: false});
		await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	});

	it('links to the internal explorer when linkTo is "internal"', async () => {
		const screen = await render(TransactionHash, {
			value: HASH,
			linkTo: 'internal',
		});
		const link = screen.getByRole('link');
		await expect.element(link).toBeInTheDocument();
		await expect
			.element(link)
			.toHaveAttribute('href', expect.stringContaining(`/explorer/tx/${HASH}`));
	});

	it('renders no link for linkTo "auto" when no block explorer is provided', async () => {
		const screen = await render(TransactionHash, {value: HASH, linkTo: 'auto'});
		await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	});

	it('links internally and to the provided explorer for linkTo "auto"', async () => {
		const screen = await render(WithBlockExplorer, {
			explorer: createBlockExplorer({
				chain: () => etherscan,
				internal: () => true,
			}),
			component: TransactionHash,
			innerProps: {value: HASH, linkTo: 'auto'},
		});
		const links = screen.getByRole('link');
		await expect
			.element(links.first())
			.toHaveAttribute('href', expect.stringContaining(`/explorer/tx/${HASH}`));
		await expect
			.element(links.last())
			.toHaveAttribute('href', `https://etherscan.io/tx/${HASH}`);
	});

	it('links the text to the provided explorer when there is no internal one', async () => {
		const screen = await render(WithBlockExplorer, {
			explorer: createBlockExplorer({
				chain: () => etherscan,
				internal: () => false,
			}),
			component: TransactionHash,
			innerProps: {value: HASH, linkTo: 'auto'},
		});
		const link = screen.getByRole('link');
		await expect
			.element(link)
			.toHaveAttribute('href', `https://etherscan.io/tx/${HASH}`);
	});
});
