/**
 * THE GREETINGS' NOTIFICATIONS, as the trigger service runs them: what a user
 * may subscribe to, and the push each match becomes. Operator code (etherfold
 * ADR-0013: conditions are data, actions are code), so it is the APP's, beside
 * its indexer logic (`../indexer`), and a descendant that drops the greetings
 * drops this folder with them.
 *
 * It runs in Node, in the trigger service, never in the browser: the notifier's
 * config (`web/notifier/triggers.config.ts`) is bundled with it by
 * `web/notifier/build.mjs`, and the tests fold it in process
 * (`test/lib/onchain/notifier.test.ts`). The app reads only `NEW_GREETING`, the
 * kind its toggle registers.
 *
 * TYPES ONLY are imported, so the browser bundle that names `NEW_GREETING`
 * carries nothing of the trigger service.
 */
import type {TriggerDefinitions} from '@etherfold/platform-nodejs-triggers';
import type {DeclarativePushNotification} from '@push-notification/server';

/** The subscription kind "notify me of new greetings": a log of MessageChanged from anyone but me. */
export const NEW_GREETING = 'new-greeting';

/** GreetingsRegistry's `MessageChanged`, the one event the notifier decodes. */
export const MESSAGE_CHANGED = {
	type: 'event',
	name: 'MessageChanged',
	inputs: [
		{indexed: true, name: 'user', type: 'address'},
		{indexed: false, name: 'message', type: 'string'},
	],
} as const;

/** How long a registration lives unless the app renews it (it renews on every load). */
export const NEW_GREETING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The longest greeting a push quotes; the rest is cut, the push being a pointer to the page. */
const QUOTED = 120;

export function greetingNotification(
	message: string,
	/** the account the push is for: the app says so when another is signed in (QA F22) */
	recipient?: string,
): DeclarativePushNotification {
	return {
		web_push: 8030,
		notification: {
			...(recipient ? {data: {account: recipient.toLowerCase()}} : {}),
			title: 'New greeting',
			body:
				message.length > QUOTED ? `${message.slice(0, QUOTED - 1)}…` : message,
			// relative, so the worker resolves it against its folder (a base path kept)
			navigate: 'demo',
			tag: NEW_GREETING,
		},
	};
}

/** The trigger definitions for one GreetingsRegistry deployment. */
export function greetingTriggers(registry: `0x${string}`) {
	return {
		events: {greeting: {address: registry, abi: MESSAGE_CHANGED}},
		subscriptions: {
			[NEW_GREETING]: {
				event: 'greeting',
				// the greeting's author is the ACCOUNT (setMessageFor attributes it so),
				// which is the address a subscription is registered for
				notFrom: 'user',
				action: 'push',
				ttlMs: NEW_GREETING_TTL_MS,
				render: (log, recipient) => ({
					message: greetingNotification(String(log.args.message), recipient),
					topic: NEW_GREETING,
				}),
			},
		},
	} satisfies TriggerDefinitions;
}
