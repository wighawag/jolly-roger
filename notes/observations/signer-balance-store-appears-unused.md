---
title: createSignerBalanceStore appears unused
type: observation
status: spotted
spotted: 2026-07-01
---

# `createSignerBalanceStore` has no consumers

While migrating the connection stores onto the shared `createPollingStore`
engine, `src/lib/core/connection/signerBalance.ts` (`createSignerBalanceStore`)
was found to have no importers anywhere in `src` (only the app's `balance` and
`gasFee` stores are wired into the context). It fetches both the signer's and
the owner's balance, so it likely predates or anticipates a smart-account /
session-key UI that shows both.

Not deleted: it may be an intended template building block (like other unused
`lib/core` pieces). Options for the maintainer:
- keep it as a documented building block (and note it as such), or
- delete it as dead code if that smart-account UI is not planned.

Refs: `src/lib/core/connection/signerBalance.ts`; no matches for
`createSignerBalanceStore` / `signerBalance` outside that file.

## Update (2026-07-01): decided KEEP as a documented building block

Maintainer chose to keep it (option 1). Rationale: it is small, correct, and
provides the distinct "signer + owner balance" piece a smart-account /
session-key UI would need, and it is idiomatic for this template to ship
unwired `lib/core` building blocks.

Done in commit `7cb8900`:
- added a header comment on `signerBalance.ts` marking it an intentional,
  unwired building block and pointing to the wiring site + this note;
- added `test/lib/core/connection/signerBalance.test.ts` exercising it through
  its interface (also the first test to cover the `createPollingStore`
  source-keyed two-fetch path).

This observation is retained for provenance; the "dead code?" question is
resolved.
