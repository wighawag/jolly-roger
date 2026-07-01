---
title: Feed the reactive deployments store into the gas-fee store (HMR-aware)
slug: reactive-deployments-in-gas-fee-store
type: idea
status: incubating
created: 2026-07-01
---

# Make the gas-fee store react to deployment/chain changes

In `src/lib/context/index.ts` the gas-fee store is created with a one-shot
snapshot of deployments (`deployments.get()`), not the reactive `deployments`
store. So if the chain/deployment info changes at runtime (notably via the HMR
deployments-store update path in `src/lib/deployments-store.ts`), the gas-fee
store keeps its stale chain config.

Idea: pass the reactive deployments store (or a derived chain-info readable)
into `createGasFeeStore` so gas estimation follows chain changes. Check whether
other context stores built from `deployments.get()` (balance, rpcHealth, ...)
have the same snapshot-vs-reactive question and want the same treatment.

Low urgency (chain rarely changes mid-session outside HMR), but it is the kind
of subtle staleness that surprises later. Captured while sweeping template TODOs
(was `// TODO use reactive deployment store ?`).
