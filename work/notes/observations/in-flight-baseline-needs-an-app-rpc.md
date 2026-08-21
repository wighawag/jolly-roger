---
title: "Without an app RPC, in-flight reconciliation degrades to \"we cannot tell\""
slug: in-flight-baseline-needs-an-app-rpc
type: observation
status: open
created: 2026-08-21
source: headless-browser probes against a dev server, run once with PUBLIC_NODE_URL unset and once with it set
---

# The nonce baseline is only as good as the RPC that answers it

Slice 4 records a pending request before dispatch and reconciles it by nonce afterwards (see `core/transaction/in-flight`). Both halves need to ask a node for the sender's next expected nonce. The context picks the source in this order:

1. the app's own RPC (`resolveAppRpcUrl`, i.e. `PUBLIC_NODE_URL` or a chain `rpcUrl`), read over plain `fetch` with `nodeNonceReader` from `core/connection/nonce-cache.ts`;
2. failing that, `publicClient.getTransactionCount`, which rides the connected wallet's provider.

The order is deliberate and `nonce-cache.ts` explains why at length: a wallet with a stale cached nonce is exactly the thing whose answer cannot be believed here.

## What the probe showed

Against a dev server started WITHOUT the env (so `hasAppRpc === false`), every reconciliation came back as `{status: 'unknown', reason: 'no-baseline'}` or `'unreadable'`, and the notice correspondingly said "we could not read the chain when the request was made". `publicClient.getTransactionCount` failed outright with `Cannot read properties of undefined (reading 'request')`, because with no app RPC and no wallet connected the connection provider has nothing to forward to.

With `PUBLIC_NODE_URL` set, the same probe captured a baseline of `140`, and a real `setMessage` sent through the UI immediately afterwards landed on chain with nonce `140`: the baseline and the transaction's actual nonce agreed exactly, which is the property the whole comparison rests on.

## Why this is an observation and not a bug

Every degraded answer is still TRUE. `no-baseline` and `unreadable` both say "we cannot tell whether this was sent, check your wallet", which is precisely what the app knows. Nothing claims a rejection it did not observe, which is the invariant that matters. So the failure mode is a weaker answer, not a wrong one.

But the weaker answer is much less useful, and an adopter deploying a wallet-only app (no `PUBLIC_NODE_URL`, no chain `rpcUrl`) gets it for every reconciliation that happens before a wallet is connected, which is most of them: reconciliation runs at startup, and startup is exactly when nobody is connected yet.

## Options, if this is worth acting on

- **Re-reconcile when a wallet connects. DONE (2026-08-21)**, prompted by a user report that a reload "does not reconcile". `reconcileWhenAccountArrives` runs another pass when an account turns up or changes, and `reconcile()` now keeps a trailing pass rather than collapsing a request made while one is running. That also fixes the separate problem this note did not name: with no account, the app cannot tell whether it ALREADY holds an operation at that nonce, so it nagged about transactions sitting in the user's list. The RPC half below still stands.
- **Say so in the UI.** The notice could mention that connecting a wallet would let the app check. Honest, but it puts a configuration detail in front of a user who cannot act on it.
- **Document the recommendation.** An app that sends transactions wants an RPC of its own for this and for the nonce-cache detector; that is worth one line wherever `hasAppRpc` is explained.
