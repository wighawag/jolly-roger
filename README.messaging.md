# `with/messaging`

The node for an app whose users talk to each other: a chat room for the whole app, and direct messages between accounts, end-to-end encrypted, on [missiv](https://github.com/wighawag/missiv). A direct message is pushed to its recipient's devices by missiv itself, through the same push server `with/push-notifications` registers them at.

```
jolly-roger@main
├─ with/local-signer
│  └─ with/hosted-account
├─ with/embedded-chain
├─ with/indexer
├─ integration                [with/local-signer, with/embedded-chain]
├─ with/push-notifications    [with/indexer, with/local-signer]
│  └─ with/messaging          ← here
└─ website
```

**Why from `with/push-notifications`** (the plan's F3-1): a chat is any app's, not a game's, and the user defined it as notifying through the push layer: a direct message reaches its recipient while the app is closed. The identity is the one that layer already has (the delegate key `@etherplay/connect` derives for the app and the wallet's signature authorising it, delegated-identity), so messaging adds no identity of its own. Rather than from `with/local-signer` with an integration branch for the notifications (two branches for one feature); the chain carries the indexer layer into messaging, which costs its install and nothing in the application source.

**It degrades to its absence** (the service-layers spec's R2): with `PUBLIC_MISSIV` empty (the default in `web/.env`), the panel says messaging is not configured, the demo offers no "message this account", and everything else is `with/push-notifications`'.

## What ships (F3-2, F3-3)

- **The room**: missiv's room of the app's domain (`@<the app's host>`), unencrypted and relayed by missiv, the last 100 messages kept; read by anyone, written by a registered account (the room logs it in by its delegate key).
- **Direct messages**: a conversation per pair of accounts, encrypted to the other's key once that key is VERIFIED against their wallet's publication signature (missiv's client trusts no key the server hands it). The first message makes a REQUEST on the other side, shown without being answered, with Accept (it becomes a conversation, marked read as it is shown) and Block (the sender reaches this account no more, in this app). To someone who has not joined yet, nothing can be encrypted: the panel offers an introduction sent in clear, only on an explicit click.
- **Registration on first use**: "Join the chat" registers the app's delegate key at missiv with the wallet's signature over its publication message. That is the signature the notifications already use, and `@etherplay/connect` 0.18 keeps it on the account, so the wallet is asked at most once for both, and a page load never asks.
- **Notifications for direct messages only**, through missiv (S3-2 of the plan): after a direct message is stored, missiv calls the push server's `/push` for each recipient's wallet with missiv's own token for this app's domain, naming the sender and never the content. Every device the recipient registered with "notify me" receives it, so there is nothing to subscribe here; the toggle says "Direct messages to you are notified too" once the account is registered with missiv. Room messages notify nobody.
- **A clicked DM notification opens its conversation** (QA F19): missiv's push leads to the app's root and carries the ids in `data.missiv` (`type`, `domain`, `namespace`, `conversationID`, `messageID`, `sender`), never an app URL, so the app routes from them. The worker hands the click to the open tab without reloading it (`serviceWorker.notificationClicks`, from template-svelte), and `createMessaging` (given those clicks in `app.ts`) opens the panel on the sender's conversation when the push is this app's domain and namespace (`openConversationsFromClicks`, `$lib/messaging/panel.ts`).

## The pieces

|                      | what                                                                                                                                                                            | where                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| missiv's stores      | `@missiv/client`'s registration, room, conversation list and conversations, each built once and working only while subscribed; accept and reject                                | `$lib/messaging/messaging.ts` (`createMessaging`)                  |
| what it is fed       | missiv's origin from `PUBLIC_MISSIV`, the page's host as missiv's domain and its origin as the app's; the account from connect (lower case)                                     | `$lib/messaging/sources.ts`                                        |
| the wallet signature | connect's `getSignatureForPublicKeyPublication`, the notifications' own adapter                                                                                                 | `$lib/push/sources.ts` (`publicationSigner`)                       |
| the panel's state    | which view is open, the inbox (the other member of each conversation, the unread and request counts), the conversation shown in its reading mode, a message box's sending state | `$lib/messaging/panel.ts`                                          |
| the panel            | a launcher on every page and a side panel (the drawer layer): the room, the inbox, one conversation; logic-less                                                                 | `$lib/ui/messaging/`, mounted in `$lib/context/AcrossPages.svelte` |
| the service          | missiv's Node.js platform (`missiv`), its rooms on the same port, its pushes through the dev push server                                                                        | `web/notifier/serve.ts` (`missiv`)                                 |

## What the node adds

- `web/src/lib/messaging/`: `messaging.ts`, `sources.ts`, `panel.ts` (above).
- `web/src/lib/ui/messaging/`: `MessagingPanel.svelte`, `RoomView.svelte`, `InboxView.svelte`, `ConversationView.svelte`, `Join.svelte`, `Composer.svelte`.
- Tests: `web/test/lib/messaging/` (the store against missiv's Node.js server in process, with no port: registration on first use with the wallet asked once, a refused or declined registration, a direct message sent encrypted, received as a request, read without being answered, accepted and read, and pushed through push-notification-server with both tokens to the recipient's device with no content; a block; the panel's views and inbox; the sources), `web/e2e/tests/messaging.e2e.ts` (two browsers: a room message seen by the other, a direct message accepted and read, its push recorded once, then clicked in the recipient's worker: the conversation opens, the tab not reloaded).

## What it changes from its stem

Each file is in `.offshoot-divergences`, under `[with/messaging]`, with its reason: the composition (`app.ts`: the messaging store beside the notifications), the dependencies and `pnpmDepsHash`, the panel's mount (`AcrossPages.svelte`), the demo (a greeting's author opens a conversation; the toggle's second line in `NotifyMe.svelte`), the env (`web/.env`, `web/.env.localhost`), the dev stack (`dev/zellij.kdl`: a fourth notifier pane; `web/notifier/serve.ts`: missiv, and the push server accepting missiv's token; `keys.mjs`: its dev token), the e2e (`scripts/run-e2e-tests.sh` starts missiv; an eighth account).

## Running it

`pnpm start` opens the dev stack with a fourth notifier pane, "missiv (messaging)", on port 34007 (`NOTIFIER_MISSIV_PORT`, a libSQL file in `web/notifier/.data`). It waits for `NOTIFIER_MISSIV_PUSH_TOKEN`, which the push server's pane writes into `web/notifier/.env.local` (`pnpm --filter ./web notifier:keys`); the push server accepts that token for the app's origin, and missiv names the app by its host (`localhost:5173`, from `NOTIFIER_APP_ORIGIN`), so open the app at `http://localhost:5173`. Not at a LAN address or `127.0.0.1` over plain http: missiv names the app by its bare host, and the push server reads a bare host other than `localhost` as `https://`, which is not the origin its tokens are for, so a direct message would reach the chat but push nothing. The room and the direct messages work in `vite dev`; their notifications need the service worker, as `README.push-notifications.md` says.

In production missiv is the operator's: `missiv --port <port>` with `DB` a libSQL URL, `PUSH_SERVER_URL` the push server and `PUSH_TOKENS="<the app's host>=<the token the push server issued missiv for it>"` (missiv's README and `docs/architecture.md`: `SERVER_ORIGIN` behind a proxy, `ADMIN_TOKEN`); the push server lists that token's hash for the app's origin beside the trigger service's. The app sets `PUBLIC_MISSIV` to missiv's origin.

**Cascade ritual**: `with/push-notifications` into this node. A conflict on `.offshoot-divergences` keeps the stem's sections and this one's; on `impersonate-addresses.json`, the superset.
