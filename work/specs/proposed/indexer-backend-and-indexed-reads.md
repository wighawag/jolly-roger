---
title: The indexer as a backend too, and the demo read from the indexer with pending-transaction awareness
type: prd
status: proposed
created: 2026-11-25
from: manual baseline QA of the template tree, findings F10 and F11 (`~/dev/qa/baseline-2026-11-24/findings.md`, kept outside the repo)
touches: with/indexer (and through it template-commit-reveal's upstream/with/indexer and below)
amends: service-layers.md (R6, for this layer only; see "R6, revisited")
---

# PRD: The indexer as a backend too, and the demo read from the indexer

## Problem

Two things surfaced while testing `with/indexer` by hand.

**The badge and the list move separately (F10).** On `/demo` the message list is the poll of `getLastMessages` (`web/src/lib/onchain/state.ts`) and the per-account count badge is the indexer's (`web/src/lib/onchain/indexer/counts.ts`, `withCounts`). `withCounts` lays the indexer's latest counts over whatever the poll last returned, with no notion of which block either describes. After a send, one moves before the other: a new message shows its old count, or a count rises before its message appears. Each source is right about its own block; the page composes two blocks into one picture.

**Everything is indexed in the tab (F11).** The node's indexer is a worker per deployment (`web/src/lib/indexer/host.ts`, `hostLiveIndexer`, one tab elected to index, the others reading), folding the chain over EIP-1193 from the contract's start block into IndexedDB. `contracts/utils/indexer.ts` runs the same processor in Node, but only for tests. On a demo chain that is instant. On a real chain with real history, folding from genesis in every new browser is too slow to be the only path, so the template does not yet show the shape an adopter actually needs.

## What already exists, so nobody re-derives it

- **A tab can start from a published snapshot.** `hostLiveIndexer` installs a publication when the tab names one (`processorBundle: {url: new URL('processor.bundle.js', appRoot())}`), produced by `etherfold build --publish` or `etherfold publish` (etherfold ADR-0095, a snapshot cut at `tip - finality` under a `publication.json` index). This node publishes none ("a demo's history is short", `README.indexer.md`).
- **An indexer server exists.** `@etherfold/server` (Hono, Node or Cloudflare Worker) and the CLI's `run` (fetch, fold and serve in one process), `serve` (read tier only), `node` (receives its processor by `etherfold upload`).
- **The same query runs against a worker and a server.** etherfold ADR-0099 and `@etherfold/accessor`: one GraphQL document, one semantics, either backend; an answer names its block's HASH and a root field may be pinned to a hash (the ADR's 2026-09-30 amendment), which is what `follower.ts` already relies on in the tab. Its tasks are done in etherfold, though the ADR's status line still says "not yet implemented": check the published versions before building on it.
- **A serving node may publish its own snapshot** (etherfold `work/specs/proposed/a-serving-node-publishes-its-own-snapshot.md`): `run`/`node`/`serve` would also answer `/{indexer}/publication.json`. Proposed, not built.
- **Transaction inclusion** (`checkTxInclusion`, `@etherfold/core`; `IndexerPort.checkTxInclusion` in `@etherfold/browser`, etherfold `CONTEXT.md`, "tx inclusion"): whether the state a client is about to render already accounts for a given transaction hash, answered from the indexer's own unconfirmed window, reorg-safe (identity is the tx hash, not the receipt's block), with `minedAtBlock` to cover a tx older than the window. It is exactly the question an app must answer before laying an OPTIMISTIC update over indexed state without counting it twice.
- **The app already tracks its own transactions by hash.** `web/src/lib/account/AccountData.ts` keeps the operations and their attempts (`hash`), observer-owned state matched by hash; `web/src/lib/view/operation.ts` derives the pending view.

## Goals

1. **The demo reads its list FROM THE INDEXER**, not only its counts, so list and counts describe ONE block and update atomically.
2. **Pending-transaction awareness, demonstrated.** A greeting the user sent shows at once as pending (optimistic), and is replaced by the indexed one exactly when the indexer's state includes that tx hash (`checkTxInclusion`), never shown twice and never counted twice, with a reorg putting it back to pending. This is the template's worked example of the mechanism, generic enough that a game copies it.
3. **The indexer can run as a backend**, self-hostable and off `main` (service-layers R3), in two roles an app can take separately:
   - **Snapshot source**: a tab installs a recent snapshot from the backend (a `serve`d publication, or a static one a job writes) and folds only the rest locally.
   - **Query source**: the tab's follower reads GraphQL from the backend when it is reachable and fresh, the in-tab worker otherwise.
4. **Everything degrades to its absence** (service-layers R2), in this order: backend query, in-tab indexer (from a snapshot when there is one, from the start block otherwise), the direct contract poll. The UI says which one it is on, rather than reporting a fault.
5. **The poll stays**, as the last fallback. While the page is on the poll, the counts (which only an indexer can give) are shown as not final: dimmed, or marked as catching up, and absent where nothing is known.

## R6, revisited

service-layers R6 says a layer augments and never replaces: `with/indexer` keeps the direct read and adds an optional field. Goal 1 makes the indexer the PRIMARY source of the list on this node. That is compatible with what R6 protects as long as (a) the poll's code path is untouched and remains the fallback, so the view renders exactly as on `main` when the indexer is absent, and (b) the change stays confined to `with/indexer`'s composition (`web/src/lib/context/app.ts`) and the demo page, not to call sites inherited from `main`. The spec proposes amending R6 for this layer to "augments, or supersedes behind a fallback to the direct read", and asks whether that is the intent (open decision 1).

## Shape (to refine when tasked)

- **One view source per page, chosen by availability.** A small selector store in `$lib/indexer/` (framework half, game-agnostic) that answers which source is live: `backend`, `tab`, or `direct`, with the reason (`unreachable`, `syncing`, `behind`, `refused` on a reorg, `stopped`). The demo's view composes from it: the indexed list and counts when `backend` or `tab` is live and synced, the poll plus non-final counts otherwise.
- **Optimistic layer over indexed state.** For each pending operation (from `AccountData`), ask `checkTxInclusion` of the source in use (a snapshot, never a subscription: ask again when `progress` moves) and render the pending greeting only while the verdict is not `included`. On the poll fallback there is no inclusion oracle: fall back to today's receipt-based behaviour and mark the counts not final.
- **Backend query source.** The follower's executor takes an endpoint: the worker port as today, or `PUBLIC_INDEXER_URL` (GraphQL over HTTP). The follower's hash pinning and reorg refusal stay the same, since the server answers with the block hash (ADR-0099 amendment). Freshness: prefer the backend only while its tip is within N blocks of the chain's.
- **Backend snapshot source.** `PUBLIC_INDEXER_PUBLICATION_URL` (or derived from `PUBLIC_INDEXER_URL` once serving nodes publish) handed to `hostLiveIndexer` as the publication; absent or unreachable means fold from the start block, as today.
- **Dev stack.** A zellij pane running `etherfold run` against the local chain with this repo's processor (the same one the worker folds), and the env wired by default in `.env.localhost`; `pnpm start` works with the pane stopped.
- **Tests.** Unit: the selector, the optimistic merge with each inclusion verdict (`included`, `absent`, `unknown`, `below-window`), a reorg putting a greeting back to pending. e2e: send with backend up (list and badge change together, never doubled), backend down (tab indexer takes over), indexer off (poll with non-final counts).

## Cascade

Home is `with/indexer`. Below jolly-roger it travels through template-commit-reveal's `upstream/with/indexer`, never through `integration` (`README.indexer.md`). template-commit-reveal's own `with/indexer` reads its board from the indexer already; whether it takes the backend roles and the optimistic layer is its decision at cascade time.

## Out of scope

- A production deployment of the backend (the app's, constrained by R3; etherfold ships `platforms/nodejs` and `platforms/cf-worker`).
- Publishing snapshots from a serving node, which is etherfold's proposed spec; this node uses a static publication until it lands.
- Moving the indexer to `main` (service-layers defers that question explicitly).

## Open decisions

1. R6 for this layer: amend to "supersedes behind a fallback to the direct read", or keep the list on the poll and solve F10 by aligning blocks only (dim a badge while the indexer is behind the poll's block)?
2. Which backend roles the template shows: both (snapshot and query), or one first. Query is the bigger change and the one that makes real chains usable at once; snapshot keeps reads trustless (the tab still folds and checks hashes).
3. What a non-final count looks like on the poll fallback: dimmed, a "catching up" mark, or hidden.
4. Trust: a backend query is a trusted read. Should the page say when it is reading a backend rather than its own fold, and should a tab cross-check a sample against the chain?
5. The human mentioned more detail on the tx-hash mechanism they have in mind; this draft assumes etherfold's `checkTxInclusion`. Confirm or correct before tasking.
