---
title: "The navigation driver can silently never attach, and nothing looks broken"
slug: navigation-driver-can-silently-never-attach
type: finding
status: fixed
created: 2026-08-21
source: reported as "no unload guard on a fresh browser load"; pinned by a console handle after three failed attempts to reproduce
---

# `attached: false`

Three rounds of a report that the unload prompt never appeared, none of it reproducible, ended with one line from the user's console:

```json
{
  "attached": false,
  "canGuardUnload": false,
  "guards": 1,
  "unloadInstalled": false,
  "wouldBlockUnload": true,
  "simulateUnload": false,
  "dispatching": 1
}
```

**No driver was ever attached to the navigation service.** The app had registered its guard (`guards: 1`), the guard said block (`wouldBlockUnload: true`), and a transaction really was in flight (`dispatching: 1`), but nothing was listening to the browser, so `beforeunload` could not fire.

## Why this took so long to find, and why it matters more than the guard

The service is INERT without a driver, by design: every query answers `undefined` and every command is a no-op, so it is constructible on the server (ADR-0002). In a browser, that same inertness means no URL updates, no history entries, no back-closes-the-overlay and no unload guard.

And **nothing looks broken**, because the overlay registry owns overlay STATE. Prompt overlays open and close perfectly well with no driver at all; only the history and URL half is missing. So the app appears to work, the wallet-action modal appears, the escape hatch appears, and the only visible symptom is a courtesy prompt that never shows.

Every hypothesis chased before this was about the browser declining to prompt (user activation, the `returnValue` legacy value, Chrome version). One of those was a real bug and was fixed. None of them was this one.

## What was actually wrong with the diagnosis, not just the code

The first console handle exposed `wouldBlockUnload()`, which asks the APP what it thinks. That returned `true` and sent the investigation off in the wrong direction for a round. The question that mattered was whether the browser would ever be asked, and that needed two more probes:

- `unloadInstalled()`: did the driver actually take the hook (did `attach` get a teardown back)?
- `simulateUnload()`: fire a real cancelable `beforeunload` and report `defaultPrevented`, which goes through whatever listener is genuinely installed.

The lesson generalises: an introspection handle that reports intent rather than effect can cost more time than it saves.

## The fix

**Attachment no longer hinges on one hook.** `afterNavigate` remains the preferred trigger, for the reason `overlay-opened-during-hydration-never-renders.md` records: attaching reports the location at once, and doing that mid-hydration opens a content overlay whose dialog never mounts. A fallback now attaches from `onMount` on the next MACROTASK, which is after hydration, and is a no-op in the normal case because `afterNavigate` has already run. In dev it says so when it has to act.

**And it can no longer fail silently.** The context warns after five seconds if `navigation.current()` is still undefined. That check lives in the SERVICE side rather than the adapter component, deliberately, so it also catches the case the component's own fallback cannot: the component never mounting at all.

Verified by disabling `afterNavigate` outright: the driver still attaches (`attached: true`, `unloadInstalled: true`) and the warning appears. The full e2e suite stays green, including `pending-operation.e2e.ts`, which is the regression guard for the hydration bug the ordering exists to avoid.

## Still open

**Why `afterNavigate` did not fire in that session is not established.** It was not HMR (tested directly: attaching survives hot updates to a page component and to the adapter component itself). The reporter's environment has two wallet extensions fighting over `window.ethereum` and throwing during page init, and a second dev server on another port, either of which could matter. The fallback makes the app correct regardless, and the new warning means the next occurrence identifies itself instead of costing four rounds.

If it recurs, the console will now say `afterNavigate did not fire on mount`, which is the signal to look at what interrupted the router's start.
