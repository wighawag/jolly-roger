---
title: core/funding and gasFee both multiply the base fee, and only a comment stops a caller stacking them
type: observation
status: spotted
spotted: 2026-08-29
---

# Two fee paths, kept apart only by prose

Noticed while extracting `core/funding` on `main` (the reusable half of `with/local-signer`'s top-up flow) and reviewing it afterwards. Recording it because the hazard is invisible at every call site, and because the thing currently preventing it is a doc comment.

## What is there

There are now two ways to get a `maxFeePerGas` in this codebase, and they apply headroom independently.

`core/connection/gasFee.ts` is the app's fee oracle. It probes `eth_feeHistory` support explicitly, polls, and returns three speeds. Its `maxFeePerGas` is a ceiling built as `baseFeePerGas * baseFeeMultiplierPercent / 100n`, defaulting to `DEFAULT_BASE_FEE_MULTIPLIER_PERCENT = 200n` (`gasFee.ts:58,79`), so it already carries 2x the base fee. `balanceCheck.ensureCanAfford` consumes it through `getGasPrice(speed)` (`balance-check-store.ts:180`).

`core/funding/sendable.ts:50` has its own one-shot `feePerGas`: `estimateFeesPerGas`, falling back to `getGasPrice`, unpolled and with no headroom of its own. It exists because sizing an offer has to work for a payer on the payment rail, which `gasFee`'s store does not track, and because the funding rules must stay callable without a store or a lifecycle.

Downstream of that, `gasReserve` (`funding-math.ts:54`) multiplies whatever fee it is handed by `FEE_SAFETY_MULTIPLIER = 2n` (`funding-math.ts:45`), for a different reason again: the wallet, not the app, picks the fee at send time.

## Why it matters

The two multipliers compose silently. A caller who reaches for the fee oracle they already know about and writes

```ts
spendableBalance({balance, maxFeePerGas: estimates.fast.maxFeePerGas})
```

reserves roughly **four times the base fee**, because `gasFee` doubled it and `gasReserve` doubles it again. Nothing fails. No test goes red, no type complains, and the transaction still sends. The only symptom is that the offer shrinks: on an expensive chain a freshly fauceted payer is told they can send noticeably less than they can, and on a payer holding barely more than the reserve the offer collapses to zero and the flow shows the faucet step to someone who already has money.

That is the same class of bug the reserve exists to prevent, arrived at from the opposite direction, and it is harder to spot because the failure is a number being conservative rather than a transaction being rejected.

## What is holding it today

Comments, in three places, all written during the review that spotted this: the `FEE_SAFETY_MULTIPLIER` doc block says it assumes a raw estimate and names `gasFee` as the thing not to feed it, `feePerGas` explains the price-versus-size distinction, and `core/funding/README.md` repeats it under "where the rest of it lives".

Prose is the correct fix for today, since there is exactly one caller and it is right. It is not a fix that survives a descendant: `core/funding` was placed upstream specifically for branches that do not exist yet (the same arrangement as `createPaymentRail`, see `payment-rail.test.ts`), and its whole premise is that a stranger reaches for it without reading the file first. A rule that only works if you read the file is the failure mode that directory was created to remove.

## Options, none taken

Not proposing one yet, since the shape depends on whether a second caller ever wants `gasFee`'s speeds while sizing an offer.

- **Make the unit explicit in the type.** Have `gasReserve` / `spendableBalance` take a branded `RawFeePerGas` rather than a bare `bigint`, so handing over a `gasFee` speed is a type error. Cheapest to enforce, and the branding has to be carried by `feePerGas`'s return for it to mean anything.
- **Give `gasFee` a raw accessor.** Expose the un-multiplied base fee alongside the three speeds, so there is one fee source with the headroom applied at exactly one layer, and `sendable.ts`'s own read goes away for callers that have the store. Does not help a payment-rail payer, which is why `feePerGas` exists at all.
- **Fold the multiplier into the reserve's caller.** Drop `FEE_SAFETY_MULTIPLIER` from `gasReserve` and make headroom something the caller states once. Most honest, and it moves a decision into every call site, which is what the constant was extracted to avoid.
- **Leave it, and test the composition.** A test asserting the reserve against a raw estimate at least fails loudly if someone changes which fee `readSendable` uses.

## Refs

- `web/src/lib/core/funding/funding-math.ts:45,54`
- `web/src/lib/core/funding/sendable.ts:50,86`
- `web/src/lib/core/connection/gasFee.ts:58,79`
- `web/src/lib/core/transaction/balance-check-store.ts:180`
- `web/src/lib/core/funding/README.md`, sections "When this cascades to a descendant" and "Where the rest of it lives"
