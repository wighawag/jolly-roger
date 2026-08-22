---
title: The merge tax is in the composition root and the demo routes, not in core/
type: finding
status: spotted
created: 2026-08-22
source: replayed every descendant merge with `git merge-tree --write-tree --name-only` on its two parents, counting real conflict events per file
---

# What actually conflicts, counted

Every discussion of this template's boundaries so far has been about `core/`. Nobody had counted where the merges actually hurt. The count is cheap: for each merge commit on a descendant branch, re-run the merge in memory against its two recorded parents and record which files came back conflicted. That reproduces the conflict as it was resolved at the time, rather than guessing from the current diff.

Forty-four merge commits reachable from `with/local-signer` and not from `main`, forty-nine on `website`, and twenty-four of `with/hosted-account`'s own on top of local-signer.

## main into with/local-signer

| conflicts | file |
|---|---|
| 6 | `web/src/lib/context/index.ts` |
| 4 | `web/src/routes/demo/lib/setGreeting.ts` |
| 4 | `web/src/routes/contracts/lib/contractCall.ts` |
| 3 | `web/test/lib/core/connection/executor.test.ts` |
| 2 | `test/.../mode.test.ts`, `test/.../connectors.test.ts`, `routes/explorer/components/AddressView.svelte`, `routes/contracts/+page.svelte`, `routes/contracts/components/ContractFunction.svelte`, `ui/pending-operation/operation-actions.ts`, `ui/navbar/navbar.svelte`, `core/ui/faucet/faucet-actions.ts`, `core/connection/mode.ts`, `core/connection/executor.ts`, `context/AcrossPages.svelte`, `account/connectors.ts`, `web/.env`, `e2e/fixtures/test.ts`, `pnpm-lock.yaml` |
| 1 | eighteen more, including `core/ui/modal/modal.svelte`, `core/transaction/AccountCannotSendModal.svelte`, `core/connection/ConnectionFlow.svelte`, `core/connection/remote.ts`, `core/connection/connection-flow.ts`, `core/connection/types.ts`, `core/connection/signer-rpc.ts`, `routes/+layout.svelte`, `context/types.ts` |

Aggregated by area, in conflict events rather than files. Modify/delete conflicts are counted the same as content conflicts throughout, so the areas sum to the 65 total:

- `src/lib/context/**`: **9** across 3 files
- `src/routes/**`: **15** across 6 files, of which 8 are two demo/tool modules
- `src/lib/core/**`: **13** across 10 files
- `web/test/**`: **11** across 7 files
- `src/lib/ui/**`: 4 across 2 files
- `src/lib/account/**` and `src/lib/dev-accounts.ts`: 3
- infrastructure (`.env`, lockfile, `package.json`, contracts, e2e fixtures): 10

So `core/` is 13 events spread thinly over 10 files, an average of 1.3 each and a maximum of 2. One single file, `context/index.ts`, carries 6 on its own. **The most-conflicted file in the tree is not in `core/` and never has been.** That should set the agenda, and until now it has not.

## local-signer into with/hosted-account

| conflicts | file |
|---|---|
| 2 | `pnpm-lock.yaml` |
| 1 | `web/package.json` |

That is the entire history: **three conflict events across twenty-four merges, none of them in application source.** `with/hosted-account` costs essentially nothing to maintain: it adds e2e tests, env values, a script and two dependencies, and touches no application source its parent does not already have. Its diff against `main` under `web/src` is byte-identical to local-signer's. **Any cost model that treats this as "four branches to cascade through" is wrong: it is two real edges (main to local-signer, main to website) plus two nearly free ones.** That matters for every cascade-cost estimate below and in the ADRs.

**It must not leak into effort estimates, and the distinction is not academic.** Conflict count measures MERGE cost. Verification cost is per node and does not shrink with it. `with/hosted-account` merged with zero conflicts during the last cascade and still needed a real fix, found only by running e2e: under hosted sign-in the wallet list is collapsed behind a button, so a suite that passed on `with/local-signer` sat for 30 seconds waiting on a control one click further in. A clean merge is evidence about text, not about behaviour. Anything touching UI or configuration gets `pnpm check`, `pnpm test:unit` and a real e2e run **on every node it reaches**, however cheap the merge was.

## main into website

| conflicts | file |
|---|---|
| 6 | `pnpm-lock.yaml` |
| 4 | `web/src/routes/+layout.svelte` |
| 1 | `+page.svelte`, `maskable_icon_512x512.png`, two workflows, two pinata files |

`website`'s entire divergence in `+layout.svelte` is three lines:

```
-		<Navbar currentPath={() => page.url.pathname} />
+		<Navbar
+			currentPath={() => page.url.pathname}
+			repoURL="https://github.com/wighawag/jolly-roger"
+		/>
```

`repoURL` is already a prop, so the extension point exists and works. The cost is not a missing slot, it is **where the slot gets filled**. It is filled inside the file `main` churns hardest (layers, overlays, banners, progress), so a three-line identity constant has cost four hand-merges. That is the worst cost-to-value ratio anywhere in the tree.

## Why `context/index.ts` conflicts six times

591 lines, one function, a strictly linear composition, ending in a 27-key object literal. Both sides insert into the middle of the sequence and both sides append keys to the literal, which is the canonical shape git cannot merge. Nothing about it is wrong as code: it is well ordered, heavily commented and each block explains itself. It is simply the one file that both a template change and a variant change must always edit, and it is a single unit so every edit lands in the same blast radius.

Note what does NOT conflict much: `core/connection/mode.ts` conflicts twice, and both were one-line resolutions ("take the branch-neutral mode.ts, keeping this branch's one line"). That is a deliberate design, documented in the module, and it is working. The lesson is not "constants in source conflict", it is "a big linear composition conflicts".

## What it costs and who pays

Whoever cascades, which today is the maintainer, on a change that usually has nothing to do with the file they are resolving. Six of the forty-four merges required hand-resolving the app's composition root. Because `with/hosted-account` inherits the resolution, the cost is paid once per cascade rather than per branch, but it is paid on the hottest file in the repo, where a wrong resolution is a silent runtime bug rather than a type error (every member is optional-looking to the compiler once it is in the literal).

## One branch this measurement deliberately excludes

`variant/offline` is **121 commits behind** and appears in none of the counts above, because it participates in no recent cascade. It is out of scope for every item in this audit, and it gets more expensive to reconcile every week it stays that way: past a certain distance a merge stops being a merge and becomes a hand port, which is a different and much larger job. Somebody should decide whether it is alive, and record the decision either way. That decision is cheap now and will not be later.

## Proposed fixes, in cost order

**1. Move the three-line identity fill out of `+layout.svelte` (cost: under an hour, cascade: near zero).** `repoURL` becomes configuration read once, not a literal in the layout. Takes `website`'s only recurring conflict to zero. See the configuration ADR.

**2. Backport the `contractCall.ts` parameter rename (cost: minutes).** Separate note; it removes a 4-conflict file for free.

**3. Split `createContext` by section into named builders (cost: a day, cascade: one contested merge at local-signer, then cheaper forever).** `buildConnection()`, `buildTransactionSafety()`, `buildChainData()`, `buildNavigation()`, each returning its slice, with `createContext` composing them and spreading the slices into the literal. A variant then adds a file and one spread rather than editing the middle of a 500-line sequence. The object literal stops being a shared append point, which is where several of the six conflicts landed.

This one is worth stating honestly: it is a refactor of the hottest file in the repo, so the cascade pays one large conflict at `with/local-signer` (which has substantially rewritten the same function) and nothing anywhere else. That is a real up-front cost against a tax that has landed on roughly one merge in seven. I would do it, but only after 1 and 2, and only with the section boundaries chosen from where the six conflicts actually landed rather than from taste.

**4. Do nothing about the demo routes.** `setGreeting.ts` and `contractCall.ts` conflict 8 times between them, and `setGreeting`'s divergence is genuine: the variant sends `setMessageFor` through a delegate instead of `setMessage` from the account. That is the example app being a different example app, which is the point of the variant. There is no extension point that would fix it, only an abstraction that would make both versions worse. Accept the 4 conflicts on `setGreeting.ts` as the price of shipping a worked example.
