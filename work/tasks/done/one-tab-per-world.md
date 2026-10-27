---
title: One tab per embedded world, a second tab refused with a way to take the world over
type: task
status: done
created: 2026-10-27
from: stratagems' port plan, step T1 (`join-template-commit-reveal` branch, `work/plans/join-template-commit-reveal.md`), decided with the maintainer on 2026-10-27
---

# One tab per embedded world

## Why

A world is persisted in the browser: webevm's dump (`offline-world-chain:<id>`), the deployment records (`offline-world-deployments:<id>`) and the chain id in `localStorage` (`offline-world:chain-id`). A second tab on `/offline-demo` restored the same id, the same dump and the same records, booted a second node from them, and from then on each tab mined its own blocks and saved its own dump over the other's. Nothing on screen looked wrong until a reload. The hazard is in what every world shares, so the guard is the mechanism's, here, and every app built on `with/embedded-chain` gets it by cascade.

## Done, 2026-10-27, on local preview branches, NOT pushed

- `web/src/lib/embedded/claim.ts` (`2382bb6c`): `createWorldClaim` holds a Web Lock (`navigator.locks.request(name, {ifAvailable: true}, ...)`, its callback resolving only on let-go, so the browser releases it when the tab closes, crashes or reloads) and refuses a second tab; `takeOver()` queues an ordinary request and posts `let-go` on a `BroadcastChannel` of the same name. The holder says so first (`LettingGo`, which a route renders instead of the world, so the world unmounts), lets go of its world, then reloads, which releases the lock and lands it on the refusal. `letGoOfWorld` is the shared half: await the boot, `dispose()`, then one barrier request, because webevm 0.9.1's `dispose` neither waits for nor cancels queued work and every request resolves only after its block's save. Exported from `$lib/embedded`.
- The lock is named by the app's WORLD (`offline-world`), not the chain id: the id changes inside a boot (an incoherent restore remints and boots the new id in the same call), so a lock named by it is released or missed at exactly those moments.
- `web/test/lib/embedded/claim.test.ts`: 11 cases on Node 24's own `navigator.locks` and `BroadcastChannel` (a second claim refused, a different world not, granted once released, the take-over in order, the holder reloading even when its world will not stop, the reloaded holder refused, abandoning a take-over, other messages ignored, and `letGoOfWorld`'s order).
- `/offline-demo` (`44076af7`): `$lib/offline` gains `offlineWorldClaim`, `enterOfflineWorld` (claim, then boot) and `takeTheOfflineWorldOver`; the route enters rather than starts, and renders `$lib/ui/embedded-chain/WorldInAnotherTab.svelte` above the world. The component is the one copy of the refusal (refused, waiting, handing over) for every world-owning route; template-commit-reveal's `/offline` uses it too.
- Fanned out to `integration` (`b7b79fe4`).

**Measured**: `with/embedded-chain` check 0/0, units 1011 -> 1022 + 46; `integration` check 0/0, 1278 -> 1289 + 60. In headless Chromium against a dev server, the demo's second tab was refused while the first held the world, and taking over moved it (the same chain id in the second tab, the first on the refusal). Before any of it, a throwaway page measured that two pages of one Playwright context share Web Locks and receive each other's `BroadcastChannel` messages, and that closing the holder releases the lock; headless Chromium reports both pages `visible`, so a truly backgrounded tab was not measurable there.

**One thing about the API, found writing the test**: Node's lock manager runs the request's callback BEFORE `request()` returns, so the promise that says the lock is free cannot be captured inside the callback; `release()` awaits it, captured after the call.
