---
title: transaction-heavy e2e suites time out under a full run and pass in isolation
slug: delegation-e2e-flakes-under-full-run
type: observation
status: open
created: 2026-08-21
---

# A third load-sensitive e2e flake, same shape as the other two

Branch: `with/local-signer`. Test: `e2e/tests/delegation.e2e.ts:183`, "takes the signature route, and explains it before the wallet opens".

Failed on 2 of 3 full runs during the slice 1-4 cascade, and passed **5 of 5 in isolation** (`pnpm test:e2e e2e/tests/delegation.e2e.ts`, whole file, two workers). The failure is always a 120s test timeout with the same call log:

```
Test timeout of 120000ms exceeded.
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for locator('[role="dialog"]').nth(2).locator('.overflow-y-auto > button').nth(5)
```

That locator is `pickSignableAccount` inside `connectPaymentWallet` (`e2e/fixtures/test.ts`): the payment connection's account picker, skipping impersonated addresses, clicking the second signable account.

## The hypothesis worth testing first

`connectPaymentWallet` loops over **every** `[role="dialog"]` on the page and acts on whichever one reads like a connect-flow step. A closed bits-ui dialog KEEPS ITS DOM: a probe during this same session dumped the page while one modal was open and found the buttons of dialogs that had already been dismissed ("Sign In", "Cancel") still present. So the loop can match a stale, closed picker, and clicking a button inside one waits forever for actionability.

`.nth(2)` in the failing call log is consistent with that: this branch has several dialogs mounted at once (two connection flows, the top-up modal, the confirmation), and which index holds the LIVE picker depends on timing.

If that is right, the fix is to scope the loop to dialogs that are actually open (`[role="dialog"][data-state="open"]`, which bits-ui sets) rather than to every dialog in the document, and it would likely make the whole fixture steadier rather than just this test.

## Not attributable to the cascade, but touched by it

The cascade changed one input to this test: `e2e/impersonate-addresses.json` gained a fourth address, because `with/local-signer` has one more transaction-sending suite than `main` (the inspector suite arrived claiming index 2, which the delegation suite already held; delegation moved to 3). `pickSignableAccount` skips impersonated addresses by prefix, so a longer list shifts which ROW is the Nth signable account: previously row 4, now row 5. The row exists either way (the burner generates 10 accounts, `ACCOUNT_COUNT` in `@etherkit/burner-wallet`), and the test passes in isolation with the new list, so the list is not the cause. It is worth knowing while reading the call log, because "nth(5)" looks like an off-by-one and is not.

## A second suite, same shape, and a measurement worth having (later the same day)

A later full run on the same branch failed `demo.e2e.ts:48` instead, also on a 120s test timeout, also waiting for a greeting that never appeared, and it too passed **11 of 11 in isolation**.

The isolated run is the useful part: it took **9.8 minutes for 11 tests**, with `should replace previous message from same account` alone taking **46.5s**. A full run does 48 tests in about 9 minutes. So these suites are not near the 120s limit with headroom to spare; they are within a small factor of it even when nothing else is competing, and a full parallel run is enough to push one over. That reframes the whole family: the likely cause is not a race in the app or a flaw in one test, it is a timeout budget set for a faster machine than the ones these run on.

Cheapest thing to try first, before hunting any individual test: raise the per-test timeout for the transaction-sending suites, or serialise them, and see whether the family disappears. If it does, the remaining question is why a single greeting round-trip costs tens of seconds against a local node, which is worth its own look but is a performance question rather than a correctness one.

## Tally

Load-sensitive e2e failures seen on this tree, all passing in isolation:

- `service-worker-gateway.e2e.ts:66` (`sw-gateway-e2e-intermittent-err-aborted.md`) — a different error (`ERR_ABORTED`), probably a different cause
- `delegation.e2e.ts:183` — 120s timeout
- `demo.e2e.ts:48` — 120s timeout
- `test/lib/context/fatal.test.ts` "is unset for a valid configuration" (unit, cold-import timeout; still has no note of its own)

The last three all look like one thing: not enough time. They share a diagnosis cost either way, since each turns a red full run into a judgement call about whether the red matters, which is exactly what a test suite is supposed to remove.
