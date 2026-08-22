---
title: "jolly-roger already fixed core/'s framework coupling; the fix is 58 lines and it is sitting 540 commits below its home"
type: finding
status: spotted
created: 2026-08-22
source: mapped the full stem chain on disk, then diffed every co-owned core/ file between template-svelte (root) and jolly-roger
follows: dead-surface-and-an-extension-point-nothing-upstream-tests
---

# The whole tree, and the one change that should move up it

The tree is four repos and seven live nodes, all owned by the same person:

```
template-svelte                 (root, 24 files in web/src)
└─ template-svelte-tailwind
   ├─ template-svelte-tailwind-blog
   └─ template-svelte-shadcn    (132 files, mostly vendored shadcn)
      └─ jolly-roger            (540 commits ahead of its stem)
         ├─ with/local-signer
         │  └─ with/hosted-account
         └─ website
```

`web/src/lib/core/` exists at **every** level and is genuinely co-owned: `utils/web/url.ts`, `utils/web/hooks.ts`, `service-worker/utils.ts`, `service-worker/scope.ts`, `notifications/index.ts` and `service-worker/push-notifications/` are **byte-identical** from the root all the way down to jolly-roger. Drift has flowed both ways in the past (`da43158`, "core: sync framework-agnostic drift from jolly-roger").

## The finding

**jolly-roger's `core/` imports `$app/*` zero times. The root's `core/` imports it six times, across three files.**

```
template-svelte  web/src/lib/core/config.ts             1   ($app/environment)
template-svelte  web/src/lib/core/service-worker/index.ts   4   (environment, paths, navigation, state)
template-svelte  web/src/lib/core/utils/web/path.ts     1   ($app/paths)
```

jolly-roger fixed all six, and the total cost of the fix, measured against the root, is **58 changed lines in two files** plus one relocation:

| co-owned file | jolly-roger vs root |
|---|---|
| `core/service-worker/index.ts` | 39+/9- |
| `core/utils/web/path.ts` | 19+/5- |
| `core/utils/web/url.ts` | identical |
| `core/utils/web/hooks.ts` | identical |
| `core/service-worker/utils.ts` | identical |
| `core/service-worker/scope.ts` | identical |
| `core/notifications/index.ts` | identical |
| `core/service-worker/push-notifications/` | identical |

Everything else is already the same file. This is not a rewrite, it is a small surgical change that has been running in production in the biggest descendant for months.

## What the fix actually is, and why it transplants cleanly

Both files are parameterisations of the same shape, and neither needs anything the root lacks (their imports are `svelte/store`, `named-logs`, and siblings that are already identical).

`core/utils/web/path.ts` takes a `PathResolver` instead of importing `resolve` from `$app/paths`:

```ts
export type PathResolver = (path: string) => string;
```

`core/service-worker/index.ts` takes a `ServiceWorkerEnvironment` (`{resolvePath, navigateTo}`) instead of importing `$app/paths`, `$app/navigation` and `$app/state`, and reads dev mode from `import.meta.env.DEV`, which is **Vite's** answer rather than the framework's and therefore not coupling at all.

The third is a relocation rather than a change: `core/config.ts` composes the app (notifications service, service worker, route handler, global query params) and imports `$app/environment`. It is not core, it is the app barrel. **jolly-roger already moved it to `lib/index.ts`** in `91ef28b`, a commit literally named "make core indepenent". The root still has it in `core/`, and the root's `lib/index.ts` is still the untouched SvelteKit scaffold placeholder:

```
// place files you want to import through the `$lib` alias in this folder.
```

Two files import `core/config` at the root (`routes/+layout.svelte`, `routes/+layout.ts`), so the move is a rename plus two import lines.

## Why this is worth doing rather than merely noting

**It makes one sentence true for seven nodes instead of one.** After it, `core/` contains no framework import anywhere in the tree, and `test/framework-boundary.test.ts` (which exists only at jolly-roger, with an empty `KNOWN_LEAKS`) can be landed at the ROOT and be true immediately at every level. A boundary rule stated once at the root is inherited by every descendant and by every template added later, which is the entire argument for having a template tree.

**It closes a real backport debt.** This is a change landed 540 commits below its home. Under the reconciliation rule it should have gone up when it was made, and every level between has been carrying the coupled version since. `template-svelte-tailwind-blog` in particular has never had the benefit.

**It costs almost nothing to cascade, because nobody has touched these files.** Every descendant's version of the two files is either identical to the root or identical to jolly-roger's; nothing in between has local modifications to lose.

## Sequencing, which matters more than the change

Land at `template-svelte`, cascade down. jolly-roger will report the two files as already-agreed (it has the destination version), so the interesting merges are at `template-svelte-tailwind`, `-blog` and `-shadcn`, all of which hold the root's version unmodified and will fast-forward to jolly-roger's.

The one piece that does NOT transplant as-is is `lib/kit/`. jolly-roger's adapter directory holds a navigation driver, shallow routing and notification navigation, none of which the root has any use for. The root needs only the two bindings the parameterisation asks for: `resolve` from `$app/paths` bound as a `PathResolver`, and a `navigateTo`. That is a ten-line `lib/kit/paths.ts` at the root, not a port of jolly-roger's directory. **Porting the whole of `lib/kit` upstream would be the mistake here**: the root does not have the problems the rest of that directory solves.

## Cost

| step | where | cost |
|---|---|---|
| move `core/config.ts` to `lib/index.ts`, fix 2 importers | `template-svelte` | 30 min |
| take jolly-roger's `path.ts` and `service-worker/index.ts` | `template-svelte` | 1 h |
| minimal `lib/kit/paths.ts` (2 bindings) | `template-svelte` | 30 min |
| cascade + verify per node | 3 intermediate repos | half a day |
| land `framework-boundary.test.ts` at the root, afterwards | `template-svelte` | 1 h |

Call it a day and a half for a tree-wide invariant, against a day for ADR-0005's move which buys the same kind of clarity for one repo. **If both are done, this one should go first**, because it decides what `core/` means everywhere and ADR-0005 is then jolly-roger applying the same rule to its own app-coupled files.

## And it settles the push-notifications question

`core/service-worker/push-notifications/` (329 lines) is **byte-identical at every level from the root down**, and unwired at every level: no importer outside its own directory in any of the four repos or any of jolly-roger's three branches, ever, since it arrived in the root's PWA work in 2025-11-29.

Its home is `template-svelte`, which is the "PWA Ready" template, and that is precisely where an unwired push-notification subscription service is ON theme rather than off it. So the earlier conclusion stands and now has a place to be executed: **do not delete, document it at the root**, with the `core/transaction/README.md` treatment (what it does, that it is deliberately unwired, what wiring it needs, how to remove it). Written once at the root, it cascades to all seven nodes for free.

Deleting is now also cheap, if the answer is that nobody wants it: because it is untouched everywhere, a deletion at the root would cascade clean with zero modify/delete conflicts. That is a product call for the root template, not a maintenance one, and the audit's recommendation is against it.
