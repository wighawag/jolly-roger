---
title: setMessage tx can fail with maxFeePerGas < maxPriorityFeePerGas on a fresh local node (pre-existing)
type: observation
status: spotted
spotted: 2026-07-01
---

# `maxFeePerGas` cannot be less than `maxPriorityFeePerGas` on a fresh local node

Submitting the initial `setMessage` tx can throw:

> `maxFeePerGas` cannot be less than the `maxPriorityFeePerGas` (1 gwei) ...
> maxFeePerGas: 0.300383893 gwei

## Root cause (NOT the store refactor)

`src/lib/core/transaction/balance-check-store.ts` builds the contract request
setting **only** `maxFeePerGas` (= `gasFee[speed].maxFeePerGas`) and does NOT set
`maxPriorityFeePerGas` (see the returned request ~line 277). viem / the node
then fills a default `maxPriorityFeePerGas` (1 gwei here). On a FRESH hardhat/
anvil node, `eth_feeHistory` reports a tiny base fee, so
`fetchGasPriceEstimates` computes `maxFeePerGas = priorityAvg + baseFee` well
under 1 gwei (0.3 gwei above). Result: `maxFeePerGas (0.3) <
maxPriorityFeePerGas (1)` -> the node rejects it.

## Verified pre-existing

- `balance-check-store.ts` is byte-identical between the pre-refactor base
  (`c174c20`) and HEAD (`git diff` empty); the refactor never touched it.
- `gasFee.ts`'s estimation MATH is byte-identical across the refactor (only
  types/wiring changed).

So the createPollingStore refactor did not introduce this; it reproduces on
base. It surfaces environment-dependently (fresh node, sub-1-gwei fees), which
is why it can look new.

## Fix direction (separate task)

Set `maxPriorityFeePerGas` alongside `maxFeePerGas` in the request
`balance-check-store` returns (use `gasFee[speed].maxPriorityFeePerGas`), and/or
clamp so `maxFeePerGas >= maxPriorityFeePerGas`. Also consider a floor for the
estimates on chains that enforce a 1 gwei min priority fee. Add a unit test on
the gasFee estimate + the request builder for the low-base-fee case.
