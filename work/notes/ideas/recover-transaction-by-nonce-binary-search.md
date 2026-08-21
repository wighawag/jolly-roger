---
title: Recover a lost transaction by binary-searching its nonce, instead of only suspecting it
slug: recover-transaction-by-nonce-binary-search
type: idea
status: incubating
created: 2026-08-21
relates-to: ADR-0004 (docs/adr/0004-view-and-system-overlays.md), work/prds/proposed/overlay-navigation-model.md
---

# Recover the transaction, not just the verdict

## What happens today

In-flight reconciliation (`core/transaction/in-flight`) has two very different outcomes depending on whether the page survived.

**The page survived.** The dispatch promise is still alive, so when the wallet finally answers, `writeContract` resolves with the hash, the tracker emits `transaction:broadcasted`, account data records a real operation and the tx-observer follows it to inclusion. Full recovery, and reconciliation is not even involved. This is the "stop waiting, approve ten minutes later" case, and it works.

**The page did not survive** (reload, tab close, crash). The promise died with it. Nothing in the new page is connected to that request, so **the app never learns the hash**. All reconciliation can do is compare the node's pending nonce against the baseline recorded just before dispatch, and conclude that *a* transaction from that account used that nonce, so this one "was most likely sent".

Measured, on a local chain, after a reload followed by approving in the wallet:

```
outcome:    {status: 'nonce-consumed', nonce: 18}
operations: []          <- the transaction list stays empty
```

That is working as designed, and the design is honest: ADR-0004 only ever promised that the outcome would be modelled as *unknown until reconciled*, never that the transaction would come back. But it is worth naming plainly that the reload path **recovers a verdict, not a transaction**: no hash, nothing in the user's list, nothing tracked to inclusion.

## The idea

Given `from`, `nonce` and a rough time, the transaction is findable, and cheaply, because **nonces are monotonic per account**.

1. `eth_getTransactionCount(account, 'latest')`. If it is at or below the record's nonce, nothing was mined and there is nothing to look for.
2. **Binary search** block heights for the first block where `eth_getTransactionCount(account, block)` exceeds the record's nonce. That block is the one containing the transaction.
3. Fetch that single block with full transactions, find the one with matching `from` and `nonce`, take its hash.
4. Hand it to account data as a recovered operation and let the tx-observer track it from there, exactly as if the hash had come back from the wallet.

Cost is about log2(range) cheap calls plus one block fetch, rather than a scan. The lower bound for the search comes from the record's `requestedAt`, which is already persisted.

## What to be careful about

- **Historical state.** `eth_getTransactionCount` at a past block needs state at that block. Full nodes keep roughly the last 128 blocks (~25 minutes on Ethereum mainnet), archive nodes keep everything, and dev chains are fine either way. So this reliably recovers a *recent* transaction and degrades to today's behaviour for an older one. That degradation is acceptable: it is what happens now.
- **It must not replace the honest verdict, only improve it.** If the search fails, or the RPC cannot answer, the outcome stays `nonce-consumed` or `unknown`. Recovery is an upgrade path, never a precondition, and nothing here may end up asserting a transaction exists because a search returned ambiguously.
- **A found transaction is not necessarily OURS.** The nonce identifies a slot, not an intent. The block gives us `to` and `data`, and the record carries `intent.to` and the function name, so the two can be compared before claiming a match. If they disagree, that is a *different* transaction that took the nonce, which is itself worth telling the user, and is strictly more than we can say today.
- **This also rescues `no-baseline`**, which is currently unrecoverable by construction: with no nonce recorded before dispatch there is nothing to compare. Matching on `from` + `intent` over a bounded recent range could still find it, at higher cost.
- **Reorgs.** A hash recovered this way should go through the tx-observer like any other, so inclusion (and re-inclusion) is tracked by the code that already knows how, rather than being assumed final at the moment of discovery.

## Why it is not built yet

Slice 4 delivered the safety property (a transaction can no longer be silently lost) and the honest reporting. This is the next step up: turning "we think this was sent" into "here it is". It is a self-contained feature with real edge cases around node capability, and deliberately not smuggled into the slice that had to stay focused on not losing transactions in the first place.
