# Synchronous, SSR-inert app context

Implements ADR-0002. Supersedes `splash-and-context-split.md`, whose sync/async split is dropped: with a synchronous context there is nothing to split and nothing to gate.

## Problem

`+layout.svelte` gates the whole layout, navbar, banners and routed page, behind `createContext()`'s promise, showing a full-screen branded splash meanwhile. Two consequences:

- Routes that use no context at all (the home page uses none) still wait.
- `+layout.ts` sets `prerender = true` and `ssr = true`, but `AsyncContext.svelte` computes `promise = browser ? ... : undefined` and so renders the splash on the server. The prerendered HTML is the splash, which means the home hero and, more importantly, the `DefaultHead` metadata inside `+page.svelte` never appear in the static HTML.

The promise it waits on has nothing to wait for. `createContext` has exactly one `await`, on `establishRemoteConnection`, whose body contains no `await` at all; `createConnection` is synchronous, and `autoConnect` runs in the background.

## Approach

Make `createContext()` synchronous, and make every service it composes constructible on the server in its idle state, so the context exists during SSR and prerendering too. Readiness keeps arriving through store state, exactly as it does today. See ADR-0002 for the decision and the rejected alternatives.

## Order

Land step 2 on its own first: it only changes behaviour in an environment nothing currently runs in, so it is behaviour-neutral today and reviewable in isolation. Then step 1 (the flip), step 4 (the fatal store), step 3 (verify the SSR render), step 5 (delete the splash).

Rollback for step 1 is restoring the await and re-wrapping the layout body. The deleted gate stays in git history, and ADR-0002 names the one condition that would justify bringing it back.

## Work

### 1. Drop the async

- `web/src/lib/core/connection/remote.ts`: `establishRemoteConnection` loses `async` / `Promise<...>`.
- `web/src/lib/context/index.ts`: `createContext` loses `async` / `await`, still returns `{context, start}`.
- `web/src/routes/+layout.svelte`: call `createContext()` synchronously and render `<Context {context}>` directly; `<AsyncContext>` disappears from the app's boot path.

`Context.svelte` is unchanged: it calls `setAppContext` at init and `context.start()` in `onMount`, so no side effect runs on the server.

### 2. Make each service idle-on-server

The rule, which is the reviewable contract for this step:

> Constructing a service never touches a browser API. Subscribing to it never starts IO on the server. All IO starts in `start()`, which runs in `onMount` and therefore only in the browser.

The rule covers lazily-constructed members too, not just what `createContext` builds eagerly. A context member exposed as a factory (mandalas' `nftsOf(owner)` is the case that motivated this) is constructed by a component during a server render, so "construction" there happens inside SSR and the same contract applies.

`getParamsFromLocation` (`core/utils/web/url.ts`) already satisfies this and is the reference implementation.

`createOfflineStore` looked like a second reference but was latently wrong, and the SSR test caught it: it tested `typeof navigator !== 'undefined'`, and Node 21+ defines a global `navigator` with no `onLine`, so `!navigator.onLine` evaluated to `true` and the server declared itself offline. Prerendered HTML would have carried the offline banner, and hydration would have mismatched. It now probes `navigator.onLine` itself. Guarding on the presence of the *capability*, not the presence of the namespace object, is the general lesson.

Note that with `prerender = true` the context is constructed once per prerendered route, not once per app. Nothing in it may carry state across constructions, and `start()` never runs at build time, which is what keeps the whole thing side-effect-free there.

The audit covered every member of `Context`. These need no change, being safe by construction: `balanceCheck` (a `writable({step: 'idle'})` whose IO only runs inside user-triggered `ensureCanAfford`), `viewState`, `rpcHealth`, `executor` and `executorAddress` (all `derived`), and `accountCannotSend` / `errorDetails` (plain writables). The rest:

- `core/connection/polling-store.ts`: the start-notifier must no-op when not in the browser, leaving the value at `{step: 'Unloaded'}` and status at `{loading: false}`. Polling currently starts on the first subscriber, so without this a server render that reads `$balance` starts a poll loop. This one guard covers `balance`, `signerBalance`, `gasFee` and `onchainState`.
- `core/connection/remote.ts`: verify only, do not implement an inert variant up front. `@etherplay/connect` already constructs cleanly in bare Node (probed: state `{step: 'Idle', loading: true, wallets: []}`, no timers or handles left, process exits on its own), because its autoConnect block and the ethereum connector's `fetchWallets` are both already behind `typeof window !== 'undefined'`. That resting `loading: true` is also what the browser renders first, so hydration matches. Add an inert fallback here only if the upstream audit finds a real break; the guarantee is being pinned by a test in `../etherplay-connect` instead. The viem clients construct against the connection's provider and are never called on the server, because the pollers are inert.
- `core/clock/index.ts`: no timers off-browser; `now()` still returns `Date.now()`, the store just does not tick.
- `core/tab-leader/TabLeaderService.ts`: `crypto.randomUUID()` ran at construction; it now runs in `start()`, which is browser-gated by `onMount`. It also no longer calls `randomUUID` at all, via the new `core/utils/web/random-id.ts`: `crypto.randomUUID` is gated on a *secure context*, so it exists on https and localhost but not over a plain http LAN address, which is how a phone on the same network reaches the dev server. `crypto.getRandomValues` carries no such gate and is used instead when `randomUUID` is missing. This was a pre-existing crash on mobile-over-LAN, not something the split introduced.
- `account/AccountData.ts`: verified inert, no change needed. `createLocalStorageAdapter` is only built inside synqable's per-account `factory`, which never runs while the account store is `undefined`, and that is the server's permanent state.
- `context/index.ts`: skip `initBurnerWallet()` off-browser (it announces on `window`). `resolveBurnerWallet` itself is pure and `burnerOverride` is already SSR-safe.
- `context/index.ts`: add the browser check to the `nonceCache` condition (already `import.meta.env.DEV && hasAppRpc`).
- `context/index.ts`: guard the `(globalThis as any).context = context` debug assignment so prerender renders do not leak into each other.
- `@etherkit/tx-observer`'s `createTransactionObserver({provider})`: verified inert at construction.

One consequence for the test suite, which matters when porting: the `server` vitest project is Node with no DOM, so tests that exercise polling now have to declare the global the guard looks for (`vi.stubGlobal('window', {})`). That is five files: `polling-store`, `balance`, `signerBalance`, `gasFee` and `onchain/state`. It mirrors the existing `localStorage` mock in `TabLeaderService.test.ts`.

### 3. Verify the SSR render of the chrome

The chrome has never been server-rendered in this app: it sits inside `AsyncContext`, which returns the splash on the server. So check for crashes before checking for mismatches. `navbar.svelte` pulls in `bits-ui`'s Drawer and Collapsible plus `vaul-svelte`, none of which have been through this app's SSR. By contrast `Toaster` (`svelte-sonner`) and `NotificationOverlay` already render server-side today, because they sit outside `AsyncContext`, so those are proven.

First, render the layout chrome in Node and assert it does not throw. `test/lib/server/` does not exist yet but is already excluded from the browser project in `vite.config.ts`, so a `.svelte.test.ts` placed there runs only in the node project. That is the harness for this.

Then confirm each disconnected render matches what the client produces on its first render, or hydration warns: `navbar.svelte` (disconnected, Connect visible), `OfflineBanner` (`offline: false`), `NonceCacheBanner` (inactive store), `RpcHealthBanner` (no failures yet), `AcrossPages` (modals closed).

Watch the clock: `createClockStore()` captures `Date.now()` at construction, so any relative timestamp rendered server-side is baked into the prerendered HTML and will differ at hydration. Operation lists are empty on the server so this should not arise, but it is checked explicitly in Acceptance rather than assumed.

### 4. Turn the configuration throws into a fatal-error store

`resolveBurnerWallet`, `resolveConnectionMode` and `resolveSignerRpc` throw for real misconfigurations, and today `AsyncContext`'s `{:catch}` renders "Failed to initialize" with a Reload button. Synchronous construction removes that catch, so the failures move onto the context as a `fatal: Readable<string | undefined>` store, and the layout renders the same error screen when it is set. No throwing, no build-time check: the app reports its own misconfiguration at runtime, through the display path it already has.

The two kinds of failure differ only in timing, and the difference is forced by hydration:

- Env-derived (`resolveConnectionMode`, `resolveSignerRpc`) is deterministic and identical on server and client, since `$env/static/public` inlines the values. Resolve it at construction. The error screen then also lands in the prerendered HTML, which means a misconfigured build turns every page of the built site into the error screen, a signal as loud as a failed build and not dependent on any `ssr`/`prerender` flag.
- Param-derived (`resolveBurnerWallet`, triggered by `?burner=true` with no node URL) is browser-only, because `getParamsFromLocation()` returns `{}` on the server. Setting it at construction would make the client's first render disagree with the server HTML. Set it in `start()` instead, which runs in `onMount`, so the screen appears immediately after hydration with no mismatch.

Extract the existing "Failed to initialize" markup from `AsyncContext.svelte` into its own component before that file is deleted in step 5.

### 5. Delete the splash

`AsyncContext.svelte` and `splash-loader.ts` go. `Context.svelte` remains the app-context provider, applied synchronously in the layout. Nothing boots behind a promise any more, so there is no gate to generalize and no `PUBLIC_SPLASH` knob to add.

An earlier draft kept a generic `BootGate` for the game-asset case. `../conquest-v1` shows that to be the wrong abstraction. Its `lib/core/ui/loading/splash.ts` drives a `{stage, loadingValue, complete}` store from pixi's `Assets.loadBundle(bundle, onProgress)`, and `SplashScreen.svelte` renders it as an overlay sibling under `{#if !$splash.complete}` with `out:fade`, with staged studio-then-game branding, per-stage minimum display times, click-to-skip and a `__visited` flag. A promise gate cannot express progress, cannot stage branding, and withholds its children so the game cannot warm up (canvas, WebGL context, scene setup) while the splash shows. The overlay does all three, and it is this plan's own rule one level up: readiness is state, not an unresolved promise.

So the supported pattern for asset or WASM preload is an overlay driven by a `Readable<number>` progress store, rendered as a sibling of the routed page. jolly-roger ships nothing for it and needs nothing: children render immediately, the context is always available, the layout already renders siblings outside the context provider (`Toaster`, `NotificationOverlay`, `#--layer-drawer`, `#--layer-modals`), and step 2's rule tells an asset store how to behave on the server. A game repo brings its own overlay as ordinary app code, so no game branch of jolly-roger is required.

## Tests

`vite.config.ts` defines two vitest projects: `client` (real Chromium, `test/**/*.svelte.{test,spec}.ts`) and `server` (`environment: 'node'`, everything else). The `.svelte.` infix is what selects the environment, so it decides where each file below lands. `expect: {requireAssertions: true}` is set globally, so every test must assert.

- `test/lib/context/sync-context.test.ts`: no `.svelte.` infix, so it runs in the node project, which is exactly the DOM-free harness this needs. Assert `typeof window === 'undefined'`, that `createContext()` returns without awaiting, and that every store sits in its idle state.
- `test/lib/core/connection/polling-store.test.ts`: extend with "does not poll off-browser, stays `Unloaded`".
- Server-rendering the chrome is gated by `pnpm build` itself, which prerenders every route in Node, rather than by a bespoke harness: rendering the chrome standalone would need `$app/state` and capability mocks for little added signal. Note that a file at `test/lib/server/*.svelte.test.ts` would run in *neither* vitest project (the client project excludes that path, the server project excludes the `.svelte.` infix); anything placed there must be named `*.test.ts`.
- `e2e/tests/hydration.e2e.ts`: asserts `/` and `/demo/` hydrate with no mismatch complaint on the console. The build catches SSR *crashes*; only this catches SSR/CSR *divergence*.
- `test/lib/context/init-error.svelte.test.ts`: the error component extracted in step 4 renders the message and the Reload button. Needs the `.svelte.` infix, or it runs in node and fails.
- `test/lib/context/fatal.test.ts`: an env-derived misconfiguration sets `fatal` at construction (so it is visible server-side), and an unhonourable `?burner=true` leaves `fatal` unset until `start()` runs.

## Acceptance

- `pnpm build` emits a prerendered `/` containing the hero markup and the `DefaultHead` meta tags (grep the built HTML).
- `/demo/` prerenders its real page markup rather than an empty shell, and the chrome appears in the prerendered output in its disconnected state. This is what distinguishes working SSR from the home page merely happening to be context-free.
- No timestamp is baked into any prerendered HTML (grep the built output).
- No splash anywhere; `AsyncContext.svelte` and `splash-loader.ts` no longer exist.
- No hydration mismatch warnings on `/` and `/demo/`.
- A misconfigured env (signer mode without `PUBLIC_WALLET_HOST`) renders the init error screen, and that screen is present in the prerendered HTML rather than failing the build.
- `?burner=true` with no node URL shows the same screen after hydration, with no mismatch warning.
- The 20 `getAppContext()` call sites are unchanged.
- `pnpm check` and `pnpm test` green.

## Porting

The same change lands in `../mandalas` and `../bleeps`. They are separate repos with no shared history, so the port is manual. All three set `prerender = true` and `ssr = true`, so the SSR-inert work matters equally in each. Measured divergence from jolly-roger today:

| file | mandalas | bleeps |
| --- | --- | --- |
| `core/connection/polling-store.ts` | identical | identical |
| `core/connection/remote.ts` | identical | identical |
| `core/clock/index.ts` | identical | identical |
| `core/tab-leader/TabLeaderService.ts` | identical | identical |
| `context/Context.svelte` | identical | identical |
| `context/AsyncContext.svelte` | identical | identical |
| `context/splash-loader.ts` | identical | identical |
| `account/AccountData.ts` | 4 lines | 4 lines |
| `context/index.ts` | 60 lines | 26 lines |
| `routes/+layout.svelte` | 45 lines | 5 lines |

So step 2, the bulk of the work, ports as verbatim file copies, and the two splash files are deleted in all three. Only `context/index.ts` and `+layout.svelte` need hand porting. This imposes a constraint on step 1 and step 4: keep the `context/index.ts` diff mechanical and append-only. Both forks have inserted domain code into the middle of that file, so reorganizing it turns a three-line port into a merge exercise.

Both forks drop their splash: they are websites, not games, and first paint is the product. mandalas additionally drops `splashImage={url('/icon.png')}` from its layout.

Fork-specific work:

- mandalas `lib/stores/nftsof.ts`. `NFTOfStore` overrides `subscribe()` to call `_fetch()` and start a 5s `setInterval`, and `_fetch` uses global `fetch()`. It is hand-rolled, so the `createPollingStore` guard does not cover it: under SSR it would perform live network IO during prerender and leak an interval per render. The recommended fix is to rebuild it on `createPollingStore` rather than bolt on another guard. It already reimplements ref-counted start/stop and owner-rescoping (that is the `source: {store, key}` option), and it is worse in ways that are real bugs: `query()` swallows errors into a permanent `Loading` state, there is no backoff, there is no `update()` for the health-banner Retry, and it cannot feed `createRpcHealthStore`. The scope is small: one consumer (`routes/wallet/+page.svelte`), and the `burning` map is dead state (declared, read twice, never written anywhere), so it can simply be deleted.
- mandalas `lib/stores/randomTokens.ts` already guards `typeof localStorage == 'undefined'` in several places but calls `window.crypto.getRandomValues` unguarded. Check whether that path is reachable at construction or on subscribe.
- bleeps adds only `saleDeployed: !!saleDeployment(deployments.get())`, which is pure. Its port is otherwise mechanical.

## Out of scope

- Reactive per-member context access (the old plan's Option 2). Unnecessary: the context is always available.
- The game splash overlay itself. jolly-roger needs nothing game-specific to support it (see step 5), so it stays in the game repo rather than on main or on a branch.
- Richer disconnected states for the chrome. The current disconnected rendering is what SSR will show; improving it is a separate, independent change.
- Any behaviour change in `@etherplay/connect` or the connection lifecycle. A regression test and a documented SSR contract are being added upstream to pin the behaviour this plan depends on; that work is tracked separately in `../etherplay-connect`.
