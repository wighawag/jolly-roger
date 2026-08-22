---
title: Behaviour in this repo is checked; structure is not. Every remaining wish is a "who may import what" rule
type: finding
status: spotted
created: 2026-08-22
source: enumerated every normative claim in the ADRs, the three READMEs and AGENTS.md, and looked for the test that holds each one
---

# The wishes have a shape, and it is not the one you would guess

`framework-boundary.test.ts` and `wallet-activity-boundary.test.ts` both say, in their own words, that a rule nothing checks is a wish. Taking the repo at its word means auditing every other claim it makes about itself. The result is more flattering than expected, and the residue is sharper.

## Enforced, and well

The behavioural claims are covered, several of them better than most production apps manage:

- **`$app/*` stays in `$lib/kit`.** `test/framework-boundary.test.ts`, with an empty `KNOWN_LEAKS`, a stale-entry check, and a guard against the file list going empty. True today: the only importers under `src/lib` are the four files in `kit/`.
- **One answer about the wallet.** `test/wallet-activity-boundary.test.ts`, an ALLOW-list rather than a deny-list, following the question rather than the file (it also watches `canDismissConnection` and `hasPendingWalletRequest` in `connection-flow.ts`), with its own detector under test.
- **One account per sending e2e suite.** `test/e2e-account-claims.test.ts`.
- **ADR-0002, the synchronous SSR-inert context.** `test/lib/context/ssr-context.test.ts` constructs the context with no DOM, asserts every store is idle, asserts no timer is started, and asserts the debug global is not installed. That is the ADR's actual contract, not a proxy for it.
- **ADR-0004, the overlay model.** `test/lib/core/ui/overlay/registry.test.ts` holds 14 cases including the hard ones the ADR calls out by name: giving back only the entries we pushed, not stealing a step when the user has moved on, a deep-linked overlay with a prompt on top. `test/lib/core/navigation/service.test.ts` holds another 13, including a guard registered before a driver attaches. `e2e/tests/overlays.e2e.ts` asserts the layer scale is applied and strictly increasing in a real browser.
- **Modal stacking is declaration order.** `test/lib/core/ui/modal/modal-stacking.svelte.test.ts`, including the decisive case (declare first, open last, still underneath).

The pattern: **anything that once caused a bug got a test, and the test asserts the property rather than the symptom.** That is the repo working as intended.

## The wishes

Every unchecked claim left is structural: a statement about where code may live or what it may import.

**1. What `core/` is.** The strongest claim the template makes about its own shape is written in exactly one place, `README.md:281`: "The reusable building blocks live in `web/src/lib/core/` and are independent of these routes." Nothing checks it, and the "adopter should not need to modify this" reading is written nowhere at all. There is no `src/lib/core/README.md`. See the separate note on what variants actually edit, and ADR-0005.

**2. Configuration.** No claim is even made, which is its own problem: nine files read `PUBLIC_*` from `$env/static/public` and nothing says whether that is fine. See the env-seam note and ADR-0006.

**3. `.svelte` files must be logic-minimal (AGENTS.md).** Holding today, checked by hand: the largest non-import script block under `src` outside shadcn is 96 lines (`routes/contracts/components/ContractFunction.svelte`), then 93 (`PendingOperationModal.svelte`) and 75 (`NavigationProgress.svelte`). Nothing egregious, and no drift found. Unenforced, and I would leave it that way: a line-count test would fire on the wrong things and the rule is about kind, not size.

**4. Never create `.svelte.ts` files, and never use runes outside `.svelte` (AGENTS.md).** Both hold today, verified: no `.svelte.ts` file exists anywhere under `src`, and the only `.ts` files matching a rune pattern are `core/ui/overlay/registry.ts` and `define.ts`, where both matches are the string `$effect(() => overlay.registerRenderer())` inside a doc comment and a warning message. These two are worth enforcing precisely because they are cheap: a fifteen-line test over `git ls-files` costs nothing, cannot false-positive if it strips comments, and the rule is absolute rather than a judgement call. This is the only wish on the list I would grant purely because it is free.

**5. The capability-versus-app-context rule (ADR-0001, `capabilities/README.md`).** "Independently constructable and optional? capability. Part of the app's composed, required runtime? app context." A design rule, not mechanically checkable, and correctly left to review.

## Two claims that are not merely unchecked, they are false

**`src/lib/kit/README.md`:** "Everything else in the app talks to framework-free interfaces ... so the parts that carry the app's actual behaviour do not name SvelteKit at all." Nine files name `$env/static/public`, one names `$env/dynamic/public`, and `$env` is a SvelteKit virtual module, not a Vite one. The sentence is true of `$app/*` and is written as though it were true of the framework. It should be narrowed to the rule the test actually enforces, or the env seam should make it true. Detail in the env-seam note.

**`src/lib/core/transaction/README.md`:** "Nothing here imports anything app-specific, so the dependency runs one way and deleting it cannot break something upstream." Of the in-flight files, `InFlightRequestsModal.svelte` imports `getAppContext` from the `$lib` barrel, which is as app-specific as an import gets. The CONCLUSION survives (deleting the modal deletes the import, so removal really is safe), but the premise as written is wrong. One sentence to fix.

That README is otherwise the best document in the repository, and its removal guide was checked line by line against the tree: the eight referencing files it lists are exactly the eight that reference the ledger. The other mentions of "in-flight" in `AccountData.ts`, `connectors.ts`, `rpcHealth.ts`, `polling-store.ts`, `nonce-cache-store.ts`, `navigation/types.ts` and `service-worker/index.ts` are all prose, none is a code reference. A removal guide that is still accurate after the subsystem grew is rare and worth saying out loud.

## What it costs and who pays

The structural wishes cost adopters, not maintainers, and they cost them silently. A maintainer knows what `core/` means because they built it. An adopter reads the name, infers a guarantee, modifies something else instead, and finds out at the next template merge. Nobody files that as a bug; they just conclude the template is hard to keep up with.

## Proposed fixes, in cost order

1. **Fifteen minutes:** narrow the two false sentences to what is true.
2. **Half an hour:** a test banning `.svelte.ts` files and runes in `.ts` (comment-stripped). Free, absolute, no judgement.
3. **Half a day plus the move:** the `core/` import rule (ADR-0005). This is the one that makes the biggest claim in the repo checkable.
4. **A day:** the single-import-site rule for configuration (ADR-0006).

Cascade for 1 and 2 is zero (a new test file and two comment edits merge cleanly everywhere). For 3 and 4, see the respective ADRs.
