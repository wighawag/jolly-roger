---
title: a writeDurably callback that throws after writing leaves part of its write in the account data, to be saved anyway
slug: a-durable-write-that-throws-may-still-have-written
type: observation
status: open
created: 2026-10-28
---

# Rejected does not mean "nothing was written"

`writeDurably(write)` (`web/src/lib/account/durable-write.ts`) runs `write` with the account's write handle, then awaits the handle's `persisted()`. If `write` makes some mutations and then throws, the call rejects with that error and waits for nothing, but the mutations already made are in the account data's memory and will be saved by the next save, debounced or immediate. So a rejection from the callback means "the write did not complete", not "nothing was written", and for a short while what `read()` shows may differ from what is on storage.

Found by review (2026-10-28) while moving the account data to synqable 0.3.1; documented in `writeDurably`'s comment (step 3). Harmless for the caller it exists for: the commit-reveal submission sends no commit on a rejection, so a partly written turn is never acted on, and the next plan overwrites it.

**The real fix is upstream:** synqable has no atomic multi-write. A batch on the write handle (several mutations under one merge timestamp, applied all or none, one save) would let `writeDurably` promise all or nothing; it is a new synqable API and a release. **A smaller change here** would await `persisted()` even when the callback throws, before rejecting, so that a rejection arrives with storage settled (what `read()` shows is what is stored, and no save is still in flight to race a retry). It narrows the window without closing it, so it is worth doing only if a caller starts reading after a rejection.
