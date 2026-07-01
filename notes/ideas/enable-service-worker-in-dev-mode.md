---
title: Optional flag to enable the service worker in dev mode
slug: enable-service-worker-in-dev-mode
type: idea
status: incubating
created: 2026-07-01
---

# Optional service-worker registration in dev mode

Today the service worker is registered only in production (`src/routes/+layout.ts`):
in dev it is deliberately skipped (a warning is logged) so HMR and reloads are
not intercepted by the SW cache. That default is correct, but it makes it hard
to develop/test the SW itself (push notifications, update flow, offline).

Idea: add an explicit opt-in (an env var like `PUBLIC_ENABLE_SW_IN_DEV`, or a
`?sw` query param, resolved like the other `PUBLIC_*` toggles) that registers
the service worker in dev when set. Default stays off. Would let a developer
iterate on `src/service-worker/` and `src/lib/core/service-worker/` without a
production build.

Captured while sweeping template TODOs (was `// TODO add option to enable
service-worker in dev mode` in `src/routes/+layout.ts`).
