import {describe, it, expect, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';

// blockExplorer reads $env/static/public; stub it so the internal-link branch
// is deterministic. The component itself no longer imports the $lib app barrel,
// so no $env/dynamic/public stub is needed.
vi.mock('$env/static/public', () => ({PUBLIC_USE_INTERNAL_EXPLORER: 'true'}));

import TransactionHash from '$lib/core/ui/ethereum/TransactionHash.svelte';

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
});
