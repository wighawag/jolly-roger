---
title: The env seam is the one worth sealing, and ADR-0001's "no $env mocks" consequence is already false
type: finding
status: spotted
created: 2026-08-22
source: enumerated every framework-coupled surface under web/src and web/*.config.*, then checked each stated consequence of ADR-0001 against the tests that exist
---

# Every framework surface, ranked by whether sealing it buys anything

`$app/*` is sealed into `src/lib/kit` and held there by `test/framework-boundary.test.ts` with an empty `KNOWN_LEAKS` list. That is done and it works: the only `$app/*` importers under `src/lib` are the four files in `kit/`, and the routes, which are exempt by definition. Nothing else is sealed. Here is the whole rest of the surface, with an honest verdict on each.

| surface | sites | SvelteKit-specific? | seal? |
|---|---|---|---|
| `$app/*` | 4 files in `kit/`, 8 in `routes/` | yes | **done** |
| `$env/static/public` | 9 files (4 in `core/`, 1 `account/`, 1 `context/`, 3 `routes/`) | yes | **yes, see below** |
| `$env/dynamic/public` | 1 (`lib/index.ts`) | yes | yes, and it can just be deleted |
| `$service-worker` | 1 (`src/service-worker/index.ts`) | yes | no |
| `import.meta.env` | 10 files | **no, this is Vite** | no |
| route conventions (`+page`, `+layout`, `[param]`, `+error`, `+page.server`) | 16 files | yes | no |
| `$lib` alias | everywhere | no, one line of Vite/tsconfig config | no |
| `svelte.config.js`: adapter-static, `fallback: '404.html'`, `paths.relative`, `bundleStrategy: 'split'`, `serviceWorker.register: false` | 1 file | yes | no |
| `prerender = true` / `ssr = true` in `+layout.ts` | 1 file | yes | no |

## The four I would NOT seam, and why

**`import.meta.env` is not a SvelteKit coupling at all.** It is Vite's, and `DEV`, `PROD`, `MODE` and `import.meta.hot` are available in any Vite-based tool. Ten files use it and all ten are gating a dev-only warning or an HMR cleanup. Wrapping it would add a module, a name and an indirection to insulate the app from a dependency it is not going to drop. The one honest argument for touching it is testability, since `import.meta.env.DEV` cannot be flipped per test, but no test currently wants to and the dev warnings it gates are already tested through their own predicates. Leave it.

**Route conventions.** `src/lib/kit/README.md` already makes the argument and it is right: routes ARE the framework's surface, and another framework would replace them wholesale. Nothing is gained by pretending otherwise.

**`svelte.config.js` and the adapter.** This file is not coupling, it is the deployment decision itself: static output, a 404 SPA fallback for IPFS, relative paths for unknown mount points, split bundles because a single large chunk stalls under throttled connections. Every line encodes intent that would have to be re-decided under any other tool. There is nothing to abstract, only something to document, and the comments already do it.

**`$service-worker`.** One import, in `src/service-worker/index.ts`, which is itself a SvelteKit-designated entry file, so it is on the framework's side of the line by the same reasoning as routes. The interesting half, registration and lifecycle, is ALREADY seamed: `core/service-worker/index.ts` takes a `ServiceWorkerEnvironment` parameter and never imports the framework.

## The one I would seam: `$env/static/public`

Not for portability. For three things portability arguments usually stand in for.

**1. It is the last framework import inside `core/`.** Four core modules (`ens/index.ts`, `utils/ethereum/blockExplorer.ts`, `ui/faucet/index.ts`, `ui/faucet/FaucetButton.svelte`) name a SvelteKit virtual module. After the `$app/*` seam, these are the only ones left, and they are the reason the `core/` boundary cannot be stated simply.

**2. ADR-0001's stated consequence is already false, in exactly the two components it names.** The ADR says:

> Core UI components (`Address`, `TransactionHash`, ...) no longer import the `$lib` app barrel; their component tests need no `$env` mocks.

The first clause is true. The second is not, and the counter-examples are the two components the sentence names:

```
test/lib/core/ui/ethereum/Address.svelte.test.ts:7
	vi.mock('$env/static/public', () => ({PUBLIC_USE_INTERNAL_EXPLORER: 'true'}));
test/lib/core/ui/ethereum/TransactionHash.svelte.test.ts:7
	vi.mock('$env/static/public', () => ({PUBLIC_USE_INTERNAL_EXPLORER: 'true'}));
```

Neither component imports `$env` directly. Both import `blockExplorer.ts`, which does. So the mock is transitive and invisible from the component, which is the worst version: a test author has to discover by failure that rendering an address requires stubbing a framework module. `test/lib/context/fatal.test.ts` pays a larger version of the same tax, needing `vi.doMock` / `vi.doUnmock` and a comment explaining that `$env/static/public` is inlined at build time.

This is a real drift between a decision and its code, and it is the kind worth recording: the ADR is not wrong about what it decided, it is wrong about what it achieved. Sealing env is what would make the sentence true.

**3. There is no single place that says what configures this app.** Nine call sites read `PUBLIC_*` names directly. An adopter editing `.env` has to grep to find who consumes what, and a misconfiguration surfaces wherever the reader happens to be. The template already learned this lesson once for the wallet question (`wallet-activity.ts`, "one answer, derived once") and once for navigation (`NavigationService`). Configuration is the third instance of the same shape and has not had it applied.

## What the shape should be, not the diff

A separate implementation prompt exists for this, so only the contract belongs here.

One module, `src/lib/config.ts` (or `core/config`, if the parsing helpers should be reusable), exporting a single frozen object built once from `$env/static/public`, with every `PUBLIC_*` name read in that file and nowhere else. It parses and validates at construction, so a bad value produces one message naming the variable rather than an undefined threading into a caller. Consumers import the object, or, for the four core modules, receive the slice they need as a parameter (`blockExplorer` already takes most of what it needs; `hasFaucet` is a boolean that could simply be passed).

Two properties matter more than the file layout:

- **`$env/static/public` is imported exactly once**, which is what makes it enforceable in the style of `framework-boundary.test.ts`: a file list, an allow-list of one, and a stale-entry check. A test that says "one import site" is a rule; a doc that says "configuration is centralised" is a wish.
- **The object is constructed, not read.** That is what lets a test build a config object literal and hand it over, instead of mocking a virtual module. It is also what lets ADR-0001's sentence become true.

Deliberately out of scope: `$env/dynamic/public`. Its only importer is `lib/index.ts`, and its only use there is `(globalThis as any).env = env;`, a console-debug handle assigned unconditionally in production alongside `(globalThis as any).vite_env = import.meta.env`. That is not a seam question, it is a line to delete or guard with `import.meta.env.DEV`. Deleting it removes the tree's only dynamic-env import as a side effect.

## What it costs and who pays

Cost on `main`: roughly a day. Nine call sites, three test files that get simpler, one new module, one new boundary test. Nothing behavioural changes, so `pnpm check` and the 684 unit tests are the whole gate.

Cascade: this is the one recommendation in the audit with a real cascade bill. `with/local-signer` reads its own `PUBLIC_*` names (`web/.env` conflicts twice already and the variant adds signer, credits and hosted-wallet configuration), so it must extend the same config object rather than adding fresh direct reads. Expect one contested merge at `with/local-signer` touching `context/index.ts` (already the worst file), free at `with/hosted-account`, and free at `website`. Call it a day upstream plus half a day resolving.

It pays for itself if, and only if, the boundary test lands with it. Centralising configuration without a test that keeps it centralised buys one tidy afternoon and then decays, and this repo has written down twice already that a rule nothing checks is a wish.
