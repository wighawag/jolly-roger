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
