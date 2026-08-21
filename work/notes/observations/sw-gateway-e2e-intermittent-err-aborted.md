---
title: service-worker-gateway e2e intermittently fails with net::ERR_ABORTED
slug: sw-gateway-e2e-intermittent-err-aborted
type: observation
status: open
created: 2026-08-20
---

# `does not register when a gateway worker already covers the scope` flakes

Observed across 8 consecutive full e2e runs on 2026-08-20 (during the overlay-navigation work, which touches nothing service-worker related): `e2e/tests/service-worker-gateway.e2e.ts:66` failed twice and passed six times, always the same test and always the same error:

```
Error: page.goto: net::ERR_ABORTED at http://127.0.0.1:4274/
```

Port 4274 is the `ipfs-emulator --gateway sw` server from `e2e/ports.ts`, started by Playwright's `webServer`. The neighbouring test at line 52 (plain static host) did not fail in any run.

Attribution: not the overlay work, and now tested rather than argued. With a build of the current tree served by the gateway emulator, the test's exact sequence (fresh context, load, wait for a controller, load again) passed **6 out of 6** driven directly, outside Playwright's harness. Inside the full suite it then failed three runs in a row while the machine was busy (a dev server, stray preview/emulator processes from timed-out runs, repeated suites), and passed again on a quiet machine. So it is load-sensitive, in the harness or the emulator rather than in the app.

Tally across this session: failed 5 of 11 full-suite runs, always this test, always `ERR_ABORTED`, always on the SECOND `goto` (the one a foreign service worker intercepts), and always fast (700-950ms).

`ERR_ABORTED` on a `goto` usually means the navigation was superseded or the connection was closed under it. Two candidates worth checking, in order:

1. The emulator server is accepting connections (Playwright's `port` wait is satisfied) but is not yet serving that route, so the first request dies. A readiness check on the actual gateway path, rather than on the port, would settle it.
2. A worker from the sibling gateway test claiming a client mid-navigation. `work/notes/findings/service-worker-first-install-reload-caused-e2e-flakiness.md` records the reload-on-claim version of this, which was fixed; this would be a different residue of the same area.

Worth a probe run in a loop (the way the earlier SW flake was pinned) rather than a guess, since one in four is frequent enough to catch quickly. The isolation harness above is a starting point: it reproduces nothing on its own, so the next step is to add the competing load (the other webServers, several workers) until it does.

Operational note for whoever picks this up: a run killed part-way leaves its `vite preview` and `ipfs-emulator` children behind, still bound to 4173/4273/4274 and serving a build directory that may since have been deleted. That produces both `ERR_ABORTED` and "port is already used", and it is worth checking for orphans before believing either.
