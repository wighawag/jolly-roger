import {describe, it, expect, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';
import {writable} from 'svelte/store';
import MessagingPanel from '$lib/ui/messaging/MessagingPanel.svelte';
import {createMessaging} from '$lib/messaging/messaging';

/**
 * R2 of the service-layers spec, in the browser: with PUBLIC_MISSIV unset the
 * app still runs, the launcher is there, and the panel says messaging is not
 * configured (rather than failing, or showing a chat that cannot connect).
 */
describe('the messaging panel, not configured', () => {
	it('opens from its launcher and says messaging is not configured', async () => {
		// the drawer layer the panel portals into, as +layout.svelte renders it
		const layer = document.createElement('div');
		layer.id = '--layer-drawer';
		document.body.appendChild(layer);

		const messaging = createMessaging({
			config: undefined,
			account: writable(undefined),
			signOwnership: vi.fn(),
		});
		const screen = await render(MessagingPanel, {messaging});

		await screen.getByTestId('messaging-launcher').click();
		await expect
			.element(screen.getByTestId('messaging-not-configured'))
			.toHaveTextContent('Messaging is not configured for this app.');
		await expect
			.element(screen.getByTestId('messaging-panel'))
			.toHaveAttribute('data-status', 'not-configured');
		layer.remove();
	});
});
