---
title: createExecutor's dispatch-guard warning cannot see the signer client it is about
slug: executor-dev-warning-does-not-see-the-signer-client
type: finding
status: resolved
created: 2026-08-21
---

# The tripwire for the cascade hazard does not cover the cascade hazard

`createExecutor` (`src/lib/core/connection/executor.ts`) warns in DEV when handed a client that does not record before dispatch:

```
[executor] the client for sendFrom "<x>" does not record transactions before
dispatching them ... Wrap it with guardDispatch(client, inFlight) where it is
built, INSIDE any memoisation ...
```

The comment above it says what it is for, and it is the right thing to want:

> `guardDispatch` is applied once, where the tracked client is built (see `lib/context`), so everything in THIS app inherits it. A variant that builds a SECOND tracked client for a local signer has to guard that one too, and nothing can do it on its behalf.

**The check only inspects `params.walletClient`.** The client a variant actually has to guard is the one `buildSignerClient` returns, which is built lazily inside the `derived` callback and is never passed through `isDispatchGuarded`. So the one client the warning exists to talk about is the one client it cannot see.

## Confirmed by probe, not by reading

Run against `with/local-signer` during the slice 1-4 cascade, with a deliberately UNGUARDED signer factory and a guarded wallet client:

```
PROBE executor status: ready
PROBE client guarded? false
PROBE warnings: []
```

The executor reached `ready`, handed out an unguarded client, and said nothing. A variant that forgot the guard would therefore lose transactions with a silent console, which is precisely the outcome the warning was added to prevent, and the reason it was believed safe to rely on.

## Home, and where it landed

`main`. `executor.ts` already carries `buildSignerClient` and `SignerClientFactory`, so main can check the client its own code path produces. It cannot be *exercised* on main (main has no signer executor), but the code it guards is main's, and landing the check on a descendant would leave every sibling unguarded.

**Fixed on `main` (`a64e478`, 2026-08-21)** before the cascade continued, so every descendant inherits it from the merge rather than from a hand port.

## Shape of the fix

Warn where the client is built, once per client object rather than once per derivation:

```ts
const {client, account} = buildSignerClient(...);
if (import.meta.env.DEV) warnIfUnguarded(client, 'signer');   // WeakSet-deduped
```

`derived` re-runs on every connection change, so an undeduped warning would repeat for the life of the session and train the reader to ignore it. That is what shipped, with a `WeakSet` so remembering a client cannot keep it alive. Three tests in `test/lib/core/connection/executor.test.ts`, two of them verified to fail against the previous code: the unguarded signer client, and the once-per-client rule.

## Also

`with/local-signer` carries `test/lib/context/signer-client-guard.test.ts`, an arrangement guard over `context/index.ts` that fails both ways this can be got wrong: not guarded at all, and guarded OUTSIDE the memoisation (which hands out a fresh wrapper per call and re-creates the untracked-client bug `memoiseSignerClient` exists to prevent). Both failure modes were verified to fail it. That guard stays: it is about `context/index.ts`'s wiring, which only descendants have, and it catches the mistake at the point it is made rather than at the point a transaction is sent. The runtime warning catches the same mistake in an app that wires its signer client somewhere this guard cannot read.
