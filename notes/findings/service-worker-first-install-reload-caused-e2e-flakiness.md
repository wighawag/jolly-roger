---
title: SW first-install claim triggered controllerchange -> location.reload, spontaneously reloading every fresh page seconds after load
type: finding
status: fixed
created: 2026-07-02
source: probe script against pnpm preview build + read of web/src/lib/core/service-worker/index.ts and web/src/service-worker/index.ts
---

# Service worker first-install reload was the main e2e flakiness root cause

Verified with a standalone Playwright probe against the production preview
build (the exact environment e2e runs in): a fresh page (clean storage, as
every e2e test starts) spontaneously reloaded ~5-10s after load. Sequence:

1. Fresh browser context loads the page; no SW is registered yet.
2. `+layout.ts` registers the service worker (production build => always).
3. The SW installs (slow: `cache.addAll` of ALL build assets, so the delay
   varies with machine load, which is why failures moved around under
   parallel test load), activates, and calls `clients.claim()`.
4. `claim()` fires `controllerchange` in the page.
5. `createServiceWorker.register()` had an unconditional
   `controllerchange -> window.location.reload()` handler.
6. The page reloads MID-TEST, wiping whatever UI state the test had built
   (open connect dialog, pending tx spinner, filled input, hydration).

This explains the observed flake signature precisely: different tests
failing on different runs, screenshots showing the app in a
"freshly reloaded" state (auto-reconnect account picker open, inputs
empty, "Loading Connect"), and heavier parallelism making it worse.

Secondary SW issue, same shape: `listenForWaitingServiceWorker` reported
`installed` workers as updates even on FIRST install, popping a spurious
"Update Available" toast over the UI during tests (visible in a failure
snapshot). Also a real-user bug, not just a test bug.

## Fixes (both in src, they are product bugs, not test bugs)

- `core/service-worker/index.ts`: only reload on `controllerchange` when
  the page was ALREADY controlled at registration time (a real update
  takeover). The initial `claim()` on first install no longer reloads.
- `core/service-worker/utils.ts`: only report an available update when
  `navigator.serviceWorker.controller` exists (i.e. an OLD worker controls
  the page); first install no longer shows "Update Available".

## Remaining e2e hardening done alongside

- Per-file burner account via `test.use({walletAccountIndex: n})` option
  fixture; contracts write-suite uses account 1 so it cannot clobber the
  demo suite's one-message-per-account state (completes fix #2 of
  e2e-demo-tests-share-one-burner-account.md).
- Account-picker locator uses `.overflow-y-auto > button` (direct children):
  each account row nests a "Copy address" button, so a descendant selector
  put copy buttons into the nth() index space.

## Verification

- Probe before fix: 2 loads (spontaneous reload). After fix: 1 load.
- Full e2e suite: 3 consecutive green runs (25/25) after the fixes;
  before them, 2 runs each had 2 failures (different tests each time).
