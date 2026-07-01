---
title: e2e "should replace previous message from same account" fails (pre-existing, not the refactor)
type: observation
status: spotted
spotted: 2026-07-01
---

# e2e demo test fails independently of the store refactor

`e2e/tests/demo.e2e.ts:228` ("should replace previous message from same
account") fails at the first assertion: after submitting message1 and
`waitForTransaction`, the message card for `First <ts>` never becomes visible
within 30s.

## Verified: NOT caused by the createPollingStore / connector refactor

Ran the full e2e suite on both the pre-refactor base (`c174c20`) and the
refactor HEAD (`547b180`). **Identical result on both: 24 passed, 1 failed**,
the same test, same error. So the store extraction is behaviour-preserving at
the e2e level; this failure pre-dates it.

## Why it is likely a test/flake issue, not an app bug

- The sibling test `should submit a greeting and see it in the list`
  (demo.e2e.ts:98) submits a greeting and asserts `getByText(...)` visible with
  the same 30s timeout, and PASSES.
- The failing test uses a class-scoped locator
  `[class*="rounded-lg border px-4 py-3"]` filtered by text. The demo card
  markup IS `... rounded-lg border px-4 py-3 sm:gap-4` (src/routes/demo/+page.svelte),
  so the substring matches, selector rot is not the cause.
- Difference worth probing: it runs AFTER other message-submitting tests in the
  same describe; state accumulated across tests (the connected burner account
  already has a message from a prior test) may mean `First <ts>` is immediately
  replaced / not the top card, or the list ordering differs from the test's
  expectation. The contract keeps ONE message per account.

## Next step (separate task)

Diagnose independently of the refactor: run this test in isolation (fresh
account/state) to see if the cross-test account reuse is the cause, and make the
assertion robust (unique account per test, or assert on the account's single
current message rather than a specific card). Not fixed here to keep the
refactor commits behaviour-preserving and scoped.
