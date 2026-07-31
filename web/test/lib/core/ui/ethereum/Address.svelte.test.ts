import {describe, it, expect, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';

// blockExplorer reads $env/static/public; stub it so the internal-link branch
// is deterministic. The component itself no longer imports the $lib app barrel,
// so no $env/dynamic/public stub is needed.
vi.mock('$env/static/public', () => ({PUBLIC_USE_INTERNAL_EXPLORER: 'true'}));

import Address from '$lib/core/ui/ethereum/Address.svelte';

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
});
