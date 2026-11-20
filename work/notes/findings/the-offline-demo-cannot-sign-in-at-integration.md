---
title: "At `integration`, the offline demo cannot send: the world's connection never signs in"
slug: the-offline-demo-cannot-sign-in-at-integration
type: finding
status: open
created: 2026-11-20
source: measured by plan step K1a (docs/plans/template-tree-features.md) with a throwaway e2e case on `/offline-demo/` at `tf-K1a/integration`, under the e2e script's `PUBLIC_NODE_URL`, before and after the world's node url fix.
---

# At `integration`, the offline demo cannot send

## What happens

On `/offline-demo/` at `integration`, type a greeting and press Send. The world's connection goes from `Idle` to `WalletConnected` and stays there; the button spins ("Loading Send") forever, no authorisation is offered, nothing is sent. Measured in Chromium through the e2e script, at `origin/integration` 9286e08a merged with K1a's changes, both before and after the consumer fix (`7caf20bb`).

## Why

`integration` signs in (`TARGET_STEP = 'SignedIn'`), so the world's connection, which takes the app's `targetStep`, must reach `SignedIn` before the local signer exists. Signing in is a step the connection flow answers, and the offline demo deliberately mounts no flow (`routes/offline-demo/+page.svelte`: "NO CONNECTION FLOW HERE"), which was right at `with/embedded-chain`, where the target is `WalletConnected` and the world's wallet answers everything itself. At `integration` nobody answers the sign-in, and nothing registers the derived key as the account's delegate either (the authorisation modal belongs to the app's context, not the world's). template-commit-reveal's `/offline` does both itself (its world signs in over its wallet and registers the key: see its `offline.e2e.ts`), which is why its offline world plays.

`integration` has no offline e2e suite, so nothing showed it.

## A visible consequence of the node url fix

Before K1a, under a configured `PUBLIC_NODE_URL`, the world's context believed it had an app RPC (the APP's url), so the demo read its messages without a connection ("No messages yet"). Since K1a it does not (a world reports no url), so its reads wait for the target step, which never comes: the demo says "Connect to load messages". That is what a dev run with no `PUBLIC_NODE_URL` already showed; the fix made the configured build agree with it. A world's provider is always there, so "readable without a wallet" could be a fact the world's connection reports; not done.

## What would fix it

The world signs in and registers its key itself, as template-commit-reveal's does (its boot is K2's subject: the offline world's shared boot), or the offline demo at `integration` targets `WalletConnected` for its world. Either way an `/offline-demo/` e2e case at `integration` then pins the node url fix end to end (K1-3 wanted one and could not have it).
