---
title: A demo branch with every feature, published beside the zero-backend site, and how a game opts into the service layers
type: prd
status: proposed
created: 2026-11-26
from: the human's manual baseline QA of the template tree (2026-11-25/26), a design discussion after F13 to F21
touches: jolly-roger (a new `demo` branch), template-commit-reveal (a second root for messaging), the games that opt in
builds-on: service-layers.md (rules R1 to R6, the "second root" amendment of 2026-11-18)
---

# PRD: A demo branch, and how a game opts into the service layers

## Problem

The human wants to publish a version of jolly-roger that shows everything the template can do: the local signer, the chain in the tab, the indexer, push notifications, the trigger service and missiv (room and direct messages). Today no branch carries all of it:

- `integration` stems from `[with/local-signer, with/embedded-chain]`: no indexer, no push, no messaging.
- `with/messaging` stems from `with/push-notifications`, itself from `[with/indexer, with/local-signer]`: no chain in the tab.

The obvious move, putting push and messaging into `integration`, has a cost the tree pays forever: template-commit-reveal's `main` is fed from `integration` (`stemBranch: "integration"`), so EVERY game would inherit the push server, the trigger service, missiv and the indexer, their dependencies, their dev-stack panes, their env and their e2e, and every cascade would verify them. It would also break service-layers R3 (`main` and what feeds the games stay decentralised; every centralised component is confined to a feature branch).

And the converse question: a game that DOES want messaging and notifications, but sits on a template-commit-reveal branch that has none, has no way to get them today.

## Decisions proposed

### 1. `integration` stays lean

`integration` keeps exactly what it has (`with/local-signer` + `with/embedded-chain`), because it is what every game is built on.

### 2. A `demo` branch at jolly-roger, a LEAF

A new branch `demo`, stem `[integration, with/messaging]` (so it carries the signer, the chain in the tab, the indexer, push and messaging), with NO descendants: no repo may take it as `stemBranch`. It exists to be published.

- Named `demo` rather than service-layers' `with/all`, because template-commit-reveal already has a `with/all` (pixi-js + nft-identity), and a name that means two different things in two adjacent repos is a trap.
- It is service-layers' "exactly one integration branch of everything", made a leaf so its cost is one node, not a subtree.
- `.offshoot-divergences`: only what composing the two stems requires (the composition in `web/src/lib/context/app.ts`, the demo pages, the dev stack's panes, env, the lockfile and `pnpmDepsHash`).
- Its own README section: what it shows, which services it needs, and that it is not a template to adopt (adopt the branch that has the feature you want).

### 3. Two sites

- **jolly-roger.eth**: jolly-roger `main`, as today: zero backend, fully decentralised.
- **demo.jolly-roger.eth** (or another name the human picks): the `demo` branch, built against public service endpoints.

### 4. A game opts in through a SECOND ROOT at template-commit-reveal

The pattern already serves the indexer (service-layers' amendment, and template-commit-reveal's `offshoot` config): `upstream/with/indexer` is fed from jolly-roger `with/indexer` (`stemBranch`), and template-commit-reveal's `with/indexer` stems from `[main, upstream/with/indexer]`. offshoot-fanout refuses a branch with both an in-repo stem and a cross-repo `stemBranch`, and a repo has ONE stem repo, so a game can only receive a layer through a template-commit-reveal branch that carries it.

For messaging (which brings push and the indexer with it):

- template-commit-reveal grows `upstream/with/messaging`, `stemBranch: "with/messaging"` (jolly-roger), a root that carries jolly-roger's layer and nothing of the game template.
- template-commit-reveal's `with/messaging` stems from `[main, upstream/with/messaging]`.
- A game that wants it takes that branch (or a combination, below) as its `stemBranch`. A game can also switch later: change its `stemBranch` and merge.

What the game template must add there, since jolly-roger's layer is about greetings:

- **Its own triggers**: the game's events and subscription kinds (for example "your turn to reveal", "a table you joined started", "the round ended"), in the place `web/src/lib/onchain/notifier/greetings.ts` holds jolly-roger's.
- **Its own processor** for the indexer the trigger service follows (template-commit-reveal's `with/indexer` already folds the board: reuse it rather than shipping jolly-roger's greetings processor).
- **Messaging scoped to the game**: the room per app is jolly-roger's; a game may want a room per table (missiv's rooms are named, so a namespace per table is possible).

## Open decisions

1. **The demo's name and host** (`demo.jolly-roger.eth`?), and whether the demo's chain is a public testnet (so the services have real history) or a LAN/dev chain.
2. **The service endpoints the demo uses** (all three are required by the layers it carries):
   - push-notification-server and missiv: multi-domain already (a token per domain), so ONE deployment of each can serve the demo and every game;
   - the trigger service: ONE APP PER SERVICE today (etherfold's `platforms/nodejs-triggers` README: "the push action pushes under one domain, so one service serves one app"), and its triggers are code. Short term: one trigger service plus one `etherfold run` per app on a shared host. Longer term: a multi-tenant trigger service, proposed in etherfold (`work/notes/ideas/a-trigger-service-that-serves-several-apps.md`).
   Where they run (a VPS, Cloudflare Workers where a platform exists), who holds the tokens, and the CORS origins (`NOTIFIER_APP_ORIGIN`-style settings per site).
3. **Combinations at template-commit-reveal.** The games stem from combination branches (reveal-or-die from `with/all`, stratagems and infinite-gambit from `with/fuzd-pixi-indexer`). A game on a combination that wants messaging needs a combination that includes it (e.g. `with/fuzd-pixi-indexer-messaging`), which is service-layers' warning about lattices. Options: add messaging only to the combinations a game actually asks for (the demand signal service-layers names), or make messaging part of one combination per game family. Not to be pre-empted: build the first one when a game asks.
4. **`with/messaging` at template-commit-reveal vs its `with/indexer`**: jolly-roger's `with/messaging` already contains `with/indexer` (the greetings processor). Should template-commit-reveal's `with/messaging` stem from `[with/indexer, upstream/with/messaging]` (reusing the board's processor, and dropping the greetings one), rather than from `main`? Likely yes; to settle when building.
5. **Verification cost**: every new node is verified on every cascade (service-layers R5). The demo is one node; each template-commit-reveal combination with messaging is one more, plus the full e2e with four services.

## Out of scope

- The multi-tenant trigger service itself (etherfold's idea note).
- Production hardening of the services (rate limits, monitoring), beyond what the demo needs to stay up.
- Moving any layer into `integration` or `main`.
