---
title: main and with/local-signer had grown two different answers to overlay paint order
slug: two-layer-schemes-met-in-the-cascade
type: observation
status: resolved
created: 2026-08-21
---

# Two implementations of one decision, reconciled at the merge

The slice 1-2 cascade hit a conflict that was not a specialisation meeting a generic improvement, which is the usual shape. Both sides had independently solved the same problem, differently:

- **`main`** (slice 2): one scale of CSS custom properties in `src/app.css` (`--z-layer-*`) applied to `[data-layer]` containers written out by hand in `+layout.svelte`, covering five layers, including the ones holding app-owned surfaces (`notice`, `toast`, `progress`). Guarded by an e2e test that reads the computed z-indexes in a real browser.
- **`with/local-signer`**: `src/lib/core/ui/layers.ts`, a single list carrying id, selector, z-index and a `holds` description, rendering its own containers with `{#each LAYERS}` and exporting the portal-target constants that the vendored shadcn `*-content.svelte` files import. Three layers (`drawer`, `modals`, `popovers`). Guarded by a unit test that also bans childless `<X.Portal />` declarations and requires every self-portalling shadcn Content to name a declared layer.

Neither was a subset of the other. `main` had more layers and put the ambient surfaces inside them; the descendant had the popover layer (a modal CONTAINS popovers, so they must sit above it), the one-list-drives-both-container-and-target property, and much stronger static guards.

## How it was resolved

Kept both halves, split by what each is:

- `app.css` keeps the SCALE (what covers what), because that is the decision and it is where slice 2 put it.
- `layers.ts` keeps the LIST (which layers exist, in order, and what each is a portal target for), because a layer is a container to render and a target to name, and both of those are code.
- `+layout.svelte` renders every container from the list, with the three content-bearing ones supplied as snippets keyed by layer name, so there are no hand-written `data-layer` divs to drift.
- `layers.test.ts` now asserts the two files agree: same layer names, same order, a `[data-layer='x']` rule for each. That is stronger than either side had, and it is the assertion that makes splitting them safe.

The popover layer went in at 140 and `progress` moved to 150, keeping the gaps of ten. The e2e list gained `popover`.

## Worth knowing for the next cascade

`layers.ts` and its test are generic UI infrastructure with nothing local-signer-specific about them: they were landed BELOW their home. The reconciliation above is a merge resolution, not a backport, so `main` still has neither the popover layer nor the static guards, and `website`/`with/hosted-account` will inherit whatever they inherit from their own stems. The candidate backport to `main` is `core/ui/layers.ts` plus `test/lib/core/ui/layers.test.ts` plus the `{#each LAYERS}` rendering, after which this conflict cannot recur.

The general lesson is the boring one the skill already states: a change landed below its home costs a hand-merge at every level, forever, and the cost is paid by whoever happens to be cascading something unrelated.
