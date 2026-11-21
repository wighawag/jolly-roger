# `with/push-notifications`

The node for an app that tells its users, by Web Push, of what happened on chain while they were away. The demo's "Notify me" toggle registers THIS DEVICE at push-notification-server and the account's TRIGGER ("a new greeting from anyone but me") at etherfold's trigger service; the trigger service follows an `etherfold run` of the greetings' processor, and on each match asks the push server to push to every device the account registered. A push delivered to the service worker is shown as a notification, or, when the app is open and focused, in the app's own notifications.

```
jolly-roger@main
├─ with/local-signer
│  └─ with/hosted-account
├─ with/embedded-chain
├─ with/indexer
├─ integration                [with/local-signer, with/embedded-chain]
├─ with/push-notifications    [with/indexer, with/local-signer]   ← here
└─ website
```

**Why from `[with/indexer, with/local-signer]`** (the plan's F2-1, the service-layers spec's `with/notifications`): the notifier follows the processor `with/indexer` defines, and both services verify one identity, the delegate key `@etherplay/connect` derives for the app and the wallet's signature authorising it (delegated-identity), which is the local signer's. Rather than from `with/local-signer` alone (the processor the notifier runs would live nowhere the app ships it).

**Why the notification is made in a service, not in the tab** (F2-2): the tab's indexer sees `MessageChanged` only while a tab is open, which is not push. The trigger service is etherfold's (ADR-0005: triggers run outside the indexer-server; ADR-0100: the reference service lives in etherfold as its own packages), the push server closes `/push` to anything but a token-holding service, and neither watches the chain itself.

**It degrades to its absence** (the spec's R2): with `PUBLIC_PUSH_SERVER`, `PUBLIC_VAPID_PUBLIC_KEY` or `PUBLIC_NOTIFIER` empty (the default in `web/.env`), the toggle is replaced by a line saying notifications are not configured, and everything else is `with/indexer`'s and `with/local-signer`'s.

## The pieces

|                | what                                                                                                                                                                                                         | where                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| the device     | @push-notification/client: the browser's push subscription against the VAPID key, registered with the delegate key's signed request and the wallet's ownership signature                                     | `$lib/push/notifications.ts`, which wraps it                                  |
| the trigger    | `POST /subscriptions {address, domain, ownershipSignature, kind}` at the trigger service, the same proof signed for its origin; renewed on every load (a trigger expires unless renewed, etherfold ADR-0012) | `$lib/push/notifications.ts`                                                  |
| what to notify | the kind `new-greeting`: a log of `MessageChanged` from anyone but the subscriber, rendered as a declarative push opening the demo                                                                           | `$lib/onchain/notifier/greetings.ts` (the app's, beside its processor)        |
| the payload    | the Declarative Web Push shape, declared once at the root, which push-notification-server's `DeclarativePushNotification` (the type its `/push` validates) is checked against                                | the root's `src/service-worker/push.ts`, the worker's push and click handlers |
| the services   | push-notification-server's Node.js platform, `etherfold run` of the greetings, the trigger service                                                                                                           | `web/notifier/`                                                               |

The wallet is asked AT MOST ONCE, and that is `@etherplay/connect`'s to ensure: the ownership signature is the account's `savedPublicKeyPublicationSignature` (a hosted account's from sign-in; a wallet's once it answered, which connect 0.18 keeps on the persisted account, bound to the account and its origin key), else `connection.getSignatureForPublicKeyPublication()` asks the wallet. The same signature serves the push server, the trigger service and missiv. A page load never prompts. The app's domain must be connect's signing origin (the page's, unless `signingOrigin` is set): `$lib/push/sources.ts` refuses to hand a service a signature for another message.

## What the node adds

- `web/src/lib/push/`: `notifications.ts` (`createNotifications`, the toggle's store: the device's status as the push client reports it, the trigger's, `enable`, `disable`), `sources.ts` (the account from the connection, the configuration from the environment, the worker's registration, connect's publication signature). The worker's push and click handlers are the root's (`src/service-worker/push.ts`, template-svelte).
- `web/src/lib/onchain/notifier/greetings.ts`: the greetings' trigger definitions, run by the trigger service; `web/src/lib/onchain/indexer/processor.bundle.ts`: the processor's `createProcessor` entry for `etherfold run`.
- `web/src/routes/demo/lib/NotifyMe.svelte`: the toggle, logic-less.
- `web/notifier/`: `build.mjs` (the processor bundle, the source from the deployment, `serve.ts` bundled with the app's definitions), `serve.ts` (the three services, and a recording push sender for the e2e; the trigger service's registration API answers CORS for the app's origin itself, @etherfold/triggers 0.2), `keys.mjs` (the dev VAPID pair and push token, into gitignored `.env.local` files).
- Tests: `web/test/lib/push/` (the store against both services in process, the adapters, and `payload-type.test.ts`: the push server's payload type is the root's), `web/test/lib/onchain/notifier.test.ts` (the definitions load, and their push passes the server's `/push`), `web/e2e/tests/greeting-notifications.e2e.ts` (enabled, a greeting by another account, one recorded push, delivered to the worker and shown).

## What it changes from its stems

Each file is in `.offshoot-divergences`, under `[with/push-notifications]`, with its reason: where the stems meet (the composition, the demo page, `contracts/package.json`, the lockfile), the composition's notifications store and the demo's toggle, the dependencies, the env (`web/.env`, `web/.env.localhost`), the dev stack (`dev/zellij.kdl`: three panes), the e2e (`scripts/run-e2e-tests.sh` starts the notifier; a seventh account). The service worker is the root's: its push handlers, and the fix of a push posted to a focused page showing no title, went home to template-svelte, and the root's unwired `core/service-worker/push-notifications/`, which this node used to omit, is gone there.

## Running it

`pnpm start` opens the dev stack with three more panes: "push server" (it runs `pnpm --filter ./web notifier:keys` first, writing the dev VAPID key pair and the push token into `web/notifier/.env.local` and the VAPID public key into `web/.env.local`), "indexer (etherfold run)" and "notifier (trigger service)", which wait for the contracts' deployment. Ports 34005 (push server, `/api`), 34002 (etherfold) and 34006 (trigger service), each `NOTIFIER_*_PORT`; the services answer ONE app origin, `http://localhost:5173` (`NOTIFIER_APP_ORIGIN`), so open the app there. The service worker is off in `vite dev` unless `PUBLIC_ENABLE_SW_IN_DEV=true`, and without it there is nothing to subscribe: try the toggle on a build (`pnpm --filter ./web build localhost && pnpm serve`, then `NOTIFIER_APP_ORIGIN=http://localhost:8080`). A real browser push goes through the browser's push service, so the dev machine needs the network.

In production each service is the operator's, configured with its own keys: push-notification-server with `PUSH_TOKENS` naming this app's origin and the trigger service's token, and a trigger service whose `delegatedIdentityVerifier` names this app's origin and its own public origin. The app then sets the three `PUBLIC_*` variables.

**Cascade ritual**: `with/indexer`, then `with/local-signer`, into this node. A conflict on `.offshoot-divergences` keeps both stems' sections and this one's; on `impersonate-addresses.json`, the superset.
