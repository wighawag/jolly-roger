---
status: accepted
created: 2026-07-01
---

# Two context tiers: optional capabilities vs. the required app context

We pass things down the Svelte tree via two deliberately separate systems rather
than one. **Capabilities** (`$lib/core/capabilities`) are optional,
independently-constructable, synchronous injectables on their own typed key
(`route`, `ens`), consumed with `useX()` and provided with `provideX()`; a
component depending only on a capability runs in any app, with a fallback or as a
no-op when unprovided. The **app context** (`$lib/context`, read via
`getAppContext()`) is the app's composed, required, async runtime (connection,
wallet client, account data, stores) behind one key with many members and one
lifecycle. We chose two tiers so standalone/core components stay portable across
apps while app-specific components still get the full runtime.

## Considered options

- **One system (atomize the app context into per-member capabilities).**
  Rejected: the app context is a composed unit built asynchronously at the root
  with interdependencies and a single `start()` teardown. Splitting it into N
  independent providers would scatter that composition and its lifecycle, force
  every `useX()` to handle "not ready yet", and lose the "fail loudly if the app
  did not set it up" property that is correct for app-specific components.
- **Put `route`/`ens` inside the app context.** Rejected: it would re-couple
  core UI components to the whole heavy app runtime, making them un-renderable in
  isolation (and un-testable without mocking `$env`, the service worker, etc.).

## Consequences

- Core UI components (`Address`, `TransactionHash`, ...) no longer import the
  `$lib` app barrel; their component tests need no `$env` mocks.
- Capabilities share one primitive, `defineCapability(label, options?)`, with
  three modes: optional (`use()` -> `T | undefined`), `{fallback}` (`use()` -> `T`),
  and `{required: true}` (`use()` throws when unprovided).
- The verb split disambiguates the two tiers: `useX()` = a capability (whatever
  its mode, e.g. `useRoute()` is a fallback capability that always returns a
  value, `useENS()` is optional), `getAppContext()` = the required app runtime.
  `getUserContext`/`setUserContext` were renamed to `getAppContext`/
  `setAppContext` to make this explicit.
- A member of the app context that later proves broadly reusable and
  independently constructable can graduate into a capability.
