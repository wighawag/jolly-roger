---
title: All demo e2e tests write to the SAME burner account and run in parallel, so same-account writes race
type: finding
status: incubating
created: 2026-07-01
source: read of web/e2e/fixtures/test.ts, web/playwright.config.ts, web/src/lib/dev-accounts.ts, web/src/lib/context/index.ts and web/src/routes/demo/+page.svelte @ 1dcfb62 (this repo)
---

# Demo e2e tests share one account under parallel execution

Ground truth from the code (not a guess):

- `playwright.config.ts` sets `fullyParallel: true` and, locally,
  `workers: undefined` (Playwright picks multiple workers). So the demo
  tests run concurrently.
- Every test that submits a greeting connects via "Dev Mode" (burner
  wallet). The burner is wired with `impersonateAddresses:
  IMPERSONATE_ADDRESSES` (`src/lib/context/index.ts`), and Dev Mode
  resolves to the SAME impersonated account every time. Per-test storage
  is cleared, but the account identity is not randomised.
- The `GreetingsRegistry` contract keeps exactly ONE message per account
  (a new `setMessage` REPLACES the previous one).
- The Hardhat node and its contract state are shared across all tests in
  a run (the node is started once by `scripts/run-e2e-tests.sh`).

## Consequence (the race)

Because N parallel tests all `setMessage` from the ONE shared account
against ONE shared contract, their writes overwrite each other. A test
that asserts "my message1 card is visible" can have message1 already
replaced by a concurrent test's write before the assertion runs. This is
the root cause of the flaky `should replace previous message from same
account` failure recorded in
`observations/e2e-replace-previous-message-fails-pre-existing.md`.

The sibling tests that only assert "my unique greeting appears at least
once" (`getByText(uniqueGreeting)`) are less exposed: they submit then
immediately check, and a concurrent overwrite usually lands after their
check. The replace-test is exposed because it asserts on TWO sequential
states of the same account with an intermediate visibility gate.

## Robust fixes (in order of thoroughness)

1. Cheap, done now: make the replace-test assert only the invariant that
   survives the race (after submitting message2, message2 is the account's
   current message and message1 is gone), and drop the brittle
   intermediate "message1 card visible" gate + class-substring locator.
2. Better, deferred: give message-submitting tests their own account so
   they cannot race. Options: run the demo describe with
   `test.describe.configure({mode: 'serial'})`, or make Dev Mode /
   the fixture pick a distinct impersonated account per test (would need
   more than 2 entries in `IMPERSONATE_ADDRESSES`, or a per-worker index).

## Refs

- `web/e2e/tests/demo.e2e.ts` (`should replace previous message from same account`)
- `web/e2e/fixtures/test.ts` (`connectWalletDevMode`, `connectedPage`)
- `web/playwright.config.ts` (`fullyParallel`, `workers`)
- `web/src/lib/context/index.ts`, `web/src/lib/dev-accounts.ts`
