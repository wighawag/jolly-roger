---
title: 'A transaction EDR REJECTS still advances the pending nonce, and wedges the account for good'
slug: a-rejected-transaction-burns-a-nonce-on-edr
type: finding
status: open
created: 2026-08-31
source: reproduced in isolation against the e2e node started by `scripts/run-e2e-tests.sh` (hardhat 3 / EDR, `edr-simulated`, `mining: {interval: 3000}`, automine off), with a 40-line Playwright test using viem and no app code at all. Probed 2026-08-31 on template-commit-reveal.
---

# A rejected transaction burns a nonce on EDR

## What happens

Drain an account to zero, send an ordinary transaction from it, and watch the node refuse it. The refusal is correct. What is not correct is that `eth_getTransactionCount(account, 'pending')` goes UP anyway, while `latest` does not move and the mempool stays empty.

The account is then wedged permanently. Every later transaction is built at the burned nonce, is accepted, returns a hash, and is never mined, because the chain will never reach the nonce below it. `hardhat_setNonce` does not put it back: it returns without error and the pending count is unchanged.

Measured, from the isolated reproduction:

```
drained                    latest=0x19 pending=0x19 bal=0x0
send THREW: Missing or invalid parameters.
after the doomed send      latest=0x19 pending=0x1a bal=0x0     <- burned
after refunding            latest=0x19 pending=0x1a bal=100 ETH
after hardhat_setNonce     latest=0x19 pending=0x1a             <- not repairable
second send                got a hash, then TIMED OUT unmined
```

The send is REJECTED rather than queued: the pending block is empty throughout, so nothing is sitting in a mempool waiting for funds. The nonce is consumed by a transaction that does not exist.

## Why it matters here, and where it actually bit

It looks like a local-development curiosity and is not. It turns the RECOVERY from an out-of-gas failure into a worse failure than the original.

`template-commit-reveal` plays moves with a local signer holding its own gas. When that signer runs dry, the app is designed to name the failure, offer a top-up, and resume the round when gas arrives, so the player does not lose a staked bond. `e2e/tests/out-of-gas.e2e.ts` drives exactly that.

What happened instead: the failing commit was refused by the node (correctly, and the app named it correctly), the node burned the signer's nonce, the player topped up, the round retried, and the retry could never mine. The round sat in `Committing` for ever, with no error and no exit, and the stake the remedy exists to protect was lost by taking the remedy. All three of the test's claims about the remedy were reachable only past this.

## What the app does about it

`send()` in `web/src/lib/placement/commit-reveal.ts` now refuses a move before it reaches the node when the app already knows the signer holds nothing: `signerBalance` loaded, and loaded a zero. No send, no burn, so the retry after a top-up mines normally.

The check is deliberately narrow, and is an assertion about the APP rather than about the chain. It costs no RPC round trip, because it reads the balance the player is already being shown; it cannot contradict the UI, because if it refuses then the screen is already offering the top-up; and an unloaded or stale store falls through to the previous behaviour rather than blocking a funded signer on a slow first poll.

It does NOT answer "can this afford THIS move". A partially funded signer can still be rejected by the node and still burn a nonce. That is a smaller window, and closing it would mean a gas estimate on every commit and every reveal, which is a real cost on a per-move path to work around someone else's defect.

## What is still unresolved

- **Whether this is EDR's bug or hardhat's wrapper.** Not investigated. The reproduction is small enough to hand upstream as-is, and doing so is worth more than guessing which layer owns it.
- **Whether real nodes do this.** Geth and reth compute the pending nonce from mempool contents, so a rejected transaction should leave it alone, which would make this local-only. Not verified against a real node, so the app's guard is justified by the failure that was observed rather than by a claim about every chain.
- **Nothing about the receipt wait, and this entry is a correction.** An earlier version of this note claimed `send()` awaits `waitForTransactionReceipt` with no timeout, so a transaction that never mines would strand the round in `Committing` for ever. That is WRONG, and it was asserted from reading the call site instead of the callee. viem defaults `timeout` to 180_000 and rejects with `WaitForTransactionReceiptTimeoutError`. Measured with the guard below temporarily disabled, sampling the round every 20s: `Committing` from t=0 through t=180, and out of it by t=200. It recovers on its own.

  What is left of the concern is much smaller and worth stating in proportion: the round is stuck for about three minutes showing only a spinner, and in a TIMED commit-reveal game a phase can be shorter than that, so a player can still lose the round to it while being told nothing. That is a wording-and-timeout question, not a hang.

- **The pending-operation UI cannot rescue THIS failure, though it rescues the general one.** The app tracks the signer's writes and the transactions page offers resubmit and cancel, which is the right answer for an ordinary stuck transaction, and viem's receipt wait even detects a replacement and resolves against it. It does not help here: a replacement deliberately reuses the ORIGINAL nonce (`ui/pending-operation/operation-actions.ts` says so, because nonces are per-account and a replacement that changed nonce would replace nothing), and the original nonce is precisely the one the chain can never reach. So every remedy the UI offers is built at the burned nonce too.

## For whoever hits this next

The signature is: the app says it is sending, the node is mining blocks, and `eth_getTransactionCount(acct,'latest')` never moves while `pending` sits one above it. Check those two counts against each other before suspecting the app. A gap between them with an empty pending block means the account is wedged and no amount of gas, waiting or re-sending from that account will help.
