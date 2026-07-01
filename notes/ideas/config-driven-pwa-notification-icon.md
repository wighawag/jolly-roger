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

## Update (2026-07-01): value is smaller than first stated

On closer look, `pwag static/icon.svg src/web-config.json` REGENERATES
`static/pwa/favicon-512.png` from the fork's `web-config.json` `icon`, and
`static/pwa/manifest.webmanifest` also references `favicon-512.png`. So a fork
that rebrands its icon DOES get its own image on push notifications: the
file CONTENT is already config-driven. The only hardcoded thing is the
filename `/pwa/favicon-512.png`, which pwag always emits.

So the remaining improvement is cosmetic: replace the two magic-string paths in
`src/service-worker/index.ts` with a single named constant (or a value read from
the generated manifest) so the icon filename lives in one place. Deletion test:
the constant is used in exactly one place (the default-push fallback), so it is a
shallow rename, not a real seam. Deliberately NOT implemented for that reason;
revisit only if pwag's output naming becomes configurable or a second consumer
of the notification icon appears.
