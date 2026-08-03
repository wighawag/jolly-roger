---
title: Polling stores re-armed their timer after stop() (fixed during extraction)
type: observation
status: spotted
spotted: 2026-07-01
---

# Polling stores could keep polling after their last subscriber left

While extracting the shared poll-with-backoff engine (`createPollingStore`), a
latent bug surfaced that each of the three hand-rolled stores shared
(`balance.ts`, `signerBalance.ts`, `gasFee.ts`):

`stop()` cleared the pending timeout, but if a `fetchContinuously()` was already
in-flight (awaiting the network fetch) when `stop()` ran, its `finally` block
re-armed `setTimeout(fetchContinuously, interval)` afterwards. There was no
"stopped" guard, so the store could keep polling the chain after its last
subscriber unsubscribed, a slow resource/RPC leak (one extra poll cycle, or an
ongoing one if the source resubscribe path fired).

Invisible while duplicated across three files; obvious the moment the logic was
built once with a "stops after last subscriber" test (the test failed with 6
fetches instead of 1).

Fix (in `createPollingStore`): a `running` flag set in `start()` / cleared in
`stop()`; the `finally` re-arms only when `running`. Covered by
`test/lib/core/connection/polling-store.test.ts` ("stops polling after the last
subscriber leaves"). The three migrated stores inherit the fix.
