# The web app

A SvelteKit 5 frontend. The root [`README.md`](../README.md) covers the monorepo, the contracts and how to run everything; this file is about `web/` itself, and in particular about the things that already exist and are easy to miss.

```bash
pnpm dev      # from web/, or `pnpm web:dev` from the root
pnpm check    # svelte-check + typescript
pnpm test     # unit (vitest) and end-to-end (playwright)
```

## Where things are

| Directory          | What it is                                                                     |
| ------------------ | ------------------------------------------------------------------------------ |
| `src/lib/core/`    | Reusable building blocks that do not know which app they are in. See ADR-0005. |
| `src/lib/kit/`     | The only place that may import `$app/*`. [README](src/lib/kit/README.md)       |
| `src/lib/context/` | The app context: what `createContext()` composes, and in which order.          |
| `src/lib/ui/`      | This app's own UI: navbar, banners, pending operations.                        |
| `src/lib/view/`    | View models derived from onchain and account state.                            |
| `src/lib/onchain/` | Contract reads.                                                                |
| `src/routes/`      | SvelteKit routes, which are the framework's own surface.                       |

## Read these before rebuilding something

Several hard problems are already solved, with the reasoning next to the code. Each of these has a README because the solution is not discoverable from the outside:

- [`core/transaction/`](src/lib/core/transaction/README.md) : in-flight transaction safety. What happens to a transaction between `eth_sendTransaction` and a hash coming back, and why the answer is never "it failed". Also `ensureCanAfford`, which turns a shortfall into the insufficient-funds modal (with the faucet in it) instead of a wallet error.
- [`core/funding/`](src/lib/core/funding/README.md) : who can pay, how much they can send, and the two funding failures nobody anticipates (an empty payer needing the faucet, and a wallet reporting a stale balance right after being funded).
- [`core/capabilities/`](src/lib/core/capabilities/README.md) : what is passed down the component tree, and what is not.
- [`core/ui/`](src/lib/core/ui/README.md) : overlays, modals and the confirmation mechanism.
- [`core/service-worker/push-notifications/`](src/lib/core/service-worker/push-notifications/README.md) : the notification pipeline.
- [`kit/`](src/lib/kit/README.md) : the framework boundary, and the test that enforces it.

The _why_ behind the non-obvious decisions is written down as ADRs on the `work` branch, cited from the code as "ADR-0004 (`work` branch)". They are not checked out; read one with `git show work:docs/adr/0004-view-and-system-overlays.md`.

## Debugging and logs

The app logs through [`named-logs`](https://github.com/wighawag/named-logs), which is **off by default** and switched on from the URL. The parser is the inline script at the top of [`src/app.html`](src/app.html); no module reads these parameters, so searching the TypeScript for them finds nothing. They are listed in `src/lib/index.ts` only so that navigation preserves them.

Turning it on takes **two** parameters, and this is the part that wastes an afternoon:

```
?debug=*&debugLevel=debug
```

`?debug=*` alone enables the namespaces but leaves the level at its default of `2` (warn), so every `logger.debug` and `logger.log` in the tree stays silent. It looks exactly like logging that is not wired up.

| Parameter    | Values                                                     | Notes                                                                                                                           |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `debug`      | `*`, or a comma-separated namespace list; `-name` excludes | `?debug=` (empty) turns logging off and clears the stored setting                                                               |
| `debugLevel` | `error` `warn` `info` `log` `debug` `trace`, or `1`-`6`    | Default `2` (warn). You almost always want `debug`                                                                              |
| `traceLevel` | same values                                                | Default `0` (never). Calls at this severity **or more severe** print a stack trace: `traceLevel=warn` traces `warn` and `error` |
| `debugLabel` | present, or a string prefix                                | Prints the namespace before each line                                                                                           |

Four sharp edges, all verified by running the parser rather than by reading it:

- **A bare `?debug` does nothing at all.** The script matches on the prefix `debug=`, so the parameter must have a value. `?debug=*` works; `?debug` is silently ignored.
- **The namespace selection is remembered, the level is not.** `debug` is written to `localStorage`, so it survives a reload and a fresh tab; `debugLevel` is not, and reverts to warn. A session that was working goes half-quiet after a reload, which reads like a bug. Re-add `debugLevel`, or clear the stored value with `?debug=`.
- **`?traceLevel=0` turns tracing fully ON.** The parser reads it as `logLevels[val] || parseInt(val) || factory.level`, and `parseInt('0')` is falsy, so it falls through to the current _debug_ level. Asking for no tracing, or making any typo in the value, gives every enabled call at that severity a stack trace: with `?debugLevel=debug&traceLevel=0`, everything down to `debug` prints one. There is no way to switch tracing off explicitly; omit the parameter instead.
- **Never call `hook()` from a module.** The inline script installs the factory on `globalThis._logFactory` before any module runs, which is what makes the URL parameters work. `named-logs` exports `hook(factory)`, which assigns that same global, so calling it would replace the configured factory with a freshly defaulted one and silently undo whatever the URL just asked for, breaking a working feature while apparently fixing it. (The `hookup()` named in `named-logs-console` is a different package, and is not a dependency here: only its minified snippet is inlined into `app.html`.)

The namespace list is never URI-decoded, so separate entries with commas: `?debug=a,b` works, and a space becomes `%20` and matches nothing.

To add logging to a module: `import {logs} from 'named-logs'; const logger = logs('my-namespace');` and then select it with `?debug=my-namespace&debugLevel=debug`.

`?eruda` loads a mobile console; custom eruda plugins are gated by the `PUBLIC_ERUDA_PLUGINS` build variable and are off by default.

## Tests

`pnpm test` runs both suites. `pnpm vitest run` alone is much faster while working.

Some tests are **boundary tests** rather than unit tests: they enumerate the tracked files with `git ls-files` and assert a structural rule. `test/framework-boundary.test.ts` (only `kit/` imports `$app/*`), `test/svelte-conventions-boundary.test.ts` (no runes outside `.svelte`), `test/wallet-activity-boundary.test.ts`. Because they read the git index, a file you have deleted but not yet staged still shows up and the test fails on the missing file. Stage the deletion and it passes.
