---
title: Drive the PWA push-notification icon/badge from web-config instead of hardcoding
slug: config-driven-pwa-notification-icon
type: idea
status: incubating
created: 2026-07-01
---

# Config-driven PWA notification icon/badge

In `src/service-worker/index.ts` the push-notification `icon` and `badge` are
hardcoded to `/pwa/favicon-512.png`. Everything else about site identity flows
from `src/web-config.json` (name, description, theme color, icon) via `pwag`
and `DefaultHead`, so a fork that changes its icon still gets the template's
favicon on push notifications.

Idea: generate/emit the notification icon+badge paths from the same
`web-config.json` + `pwag` pipeline (or read them from a generated manifest the
SW can import), so rebranding is a single-source change. Keep a sensible
fallback if the config value is absent.

Fits the template's "rename in one place" goal. Captured while sweeping template
TODOs (was two `// TODO template it ?` on the icon/badge lines).
