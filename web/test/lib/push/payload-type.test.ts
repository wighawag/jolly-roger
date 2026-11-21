// The push this node's server sends is the push the root's worker shows.
//
// The service worker's push and click handlers are the root's
// (`src/service-worker/push.ts`, template-svelte, tested there), typed by the
// Declarative Web Push payload the root declares once. push-notification-server
// has its own type for the same shape, the one its `/push` validates and the
// trigger service's config (`src/lib/onchain/notifier/`) writes. This node
// declares neither again: it checks that what the server accepts is what the
// worker reads, so a payload field the server adds, renames or retypes fails
// `pnpm check` here instead of a notification showing wrong.
import {describe, expect, expectTypeOf, it} from 'vitest';
import type {DeclarativePushNotification as Served} from '@push-notification/server';
import {
	notificationFromPush,
	type DeclarativePushNotification as Shown,
} from '../../../src/service-worker/push';

describe("the push server's payload", () => {
	it("is the root's Declarative Web Push payload", () => {
		expectTypeOf<Served>().toMatchTypeOf<Shown>();
		// The same, as an assignment `pnpm check` type-checks with the rest.
		const served: Served = {
			web_push: 8030,
			notification: {title: 'A greeting', navigate: 'https://app.example/'},
		};
		const shown: Shown = served;
		expect(
			notificationFromPush(JSON.stringify(shown), '/icon.png'),
		).toMatchObject({title: 'A greeting'});
	});
});
