# The framework adapter layer

**This directory is the only place that should import `$app/*`.**

NOT YET ENFORCED. The lint rule that turns this from a convention into a
guarantee is slice 3 of the overlay-navigation PRD; until it lands, this is a
rule people can break without anything failing. Treat existing `$app/*` imports
elsewhere as debt to move here, and do not add new ones.

Everything else in the app talks to framework-free interfaces (`NavigationService`
in `$lib/core/navigation`, capabilities in `$lib/core/capabilities`), so the parts
that carry the app's actual behaviour do not name SvelteKit at all. Swapping the
framework then means writing another adapter here, rather than auditing the tree
for hidden coupling.

That rule is the enforceable version of "framework-agnostic": portability is
decided by what a module imports, not by where it sits, so the directory layout
elsewhere is free to be whatever reads best. See ADR-0004 (`work` branch,
`docs/adr/`).

## What lives here

- `navigation-driver.ts` / `KitNavigation.svelte`: SvelteKit's implementation of
  the navigation seam (shallow routing via `pushState`/`replaceState`, the
  location stream via `page` plus `popstate`/`hashchange`).

## What does not

Existing `$app/*` imports elsewhere in the tree pre-date this rule and are being
moved in over time (see the overlay-navigation PRD, slice 3). New ones are not
acceptable outside this directory.
