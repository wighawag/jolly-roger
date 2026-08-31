---
title: An upstream comment points into a descendant's file, and nothing upstream can check it
type: observation
status: spotted
spotted: 2026-08-31
---

# `payment-rail.test.ts` on `main` names a file that is not the composition site

`main`'s `web/test/lib/core/connection/payment-rail.test.ts:8-9` says:

> Nothing on this branch imports it. `with/local-signer` does (`context/index.ts`), to sell credits over a second connection with its own payer.

The path is wrong. On `with/local-signer` the rail is composed in `web/src/lib/context/core.ts:282`, inside `buildConnection`, and that branch's `context/index.ts` does not mention payment at all.

## It was true when written, and was invalidated the next day

- `67d8e27` (2026-08-22, `main`) added the test, "Let main notice when it breaks the payment rail". At that point `6137205` (2026-08-16, `with/local-signer`) had indeed put the `createPaymentRail` call in `context/index.ts`, so the pointer was correct.
- `3de68d1` (2026-08-23, `main`) "context: split the composition into the template's half and this app's" moved the composition into `core.ts`. It cascaded into the descendants and carried the call with it. The pointer in the `main` test was not updated, because nothing pointed at it.

## The second wrongness, which is structural rather than a typo

The file is byte-identical on `main`, `with/local-signer`, `with/hosted-account` and `website` (`variant/offline` does not carry it). So on `with/local-signer` the inherited header asserts "Nothing on this branch imports it" while sitting in a branch that imports it in `context/core.ts`. A comment written in first-person-branch voice ("this branch") becomes false the moment it cascades to a branch where the sentence is not true, and cascading is the normal case for anything on `main`.

## Why it matters more than the one-line fix

`main` cannot keep this honest by any means it has. Nothing on `main` compiles, imports, greps or tests `context/index.ts` on a descendant, so the reference is unverifiable exactly where it lives. The extension-point pattern this test exists to protect (a building block placed upstream, tested upstream, composed downstream) inherently wants to say where the consumer is, and that is the one thing the upstream branch cannot check. This will recur for every such pointer: `core/funding/README.md:5` and `core/ui/faucet/faucet-actions.ts:81` both name the same pattern and are candidates for the same rot.

Cost when it misleads: a reader following the pointer to understand how the extension point is used opens the wrong file, finds nothing, and concludes either that the rail is unused or that they are on the wrong branch. It was noticed only because a rail defect sent someone looking for the composition site.

## Options for the maintainer

1. Fix the two sentences on `main` and cascade. Cheapest, and it rots again at the next refactor of a descendant's file layout.
2. Stop naming the descendant's path. Say a descendant composes it, name the branch, and let the reader grep. Loses a genuinely useful pointer to keep an unverifiable one from lying.
3. Say it in a form `main` can check: name only symbols (`createPaymentRail` is called by the app that wants a rail), since `main` can at least assert that nothing on `main` calls it, which the test already does.
4. Rewrite the "this branch" voice out of anything that cascades, so a sentence inherited by a descendant is still true there. This is the part worth generalising past this file.

Recommendation if only one is taken: 3 plus 4, since together they remove the class rather than this instance.

Refs: `main` `web/test/lib/core/connection/payment-rail.test.ts:6-12`; `with/local-signer` `web/src/lib/context/core.ts:282`; commits `67d8e27`, `3de68d1`, `6137205`.
