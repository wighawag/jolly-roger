---
title: "Parameterising a component to satisfy a boundary rule silently defaulted every page's canonical URL to /"
type: finding
status: fixed
created: 2026-08-22
source: caught while cascading the framework-seam backport, by reading the descendants' call sites rather than by any test
follows: the-framework-seam-belongs-at-the-root-template
---

# The rule was satisfied and the product was broken

Backporting the `$app/*` seam to `template-svelte` left three files outside `core/` still importing the framework. Two were easy. The third, `lib/Head.svelte`, reads `page.url.pathname` to build the canonical and `og:url` metadata, and it was parameterised the same way as the others: take the value as a getter prop, let the route supply it.

That made `KNOWN_LEAKS` land empty, which felt like the right result and was not.

The prop had to be OPTIONAL. A required one turns every existing `<Head>` call site in every descendant into a compile error, and there is no version of "the template just broke your build" that is acceptable for a metadata component. So it was optional, with `?? '/'` as the fallback.

**`conquest-website-2` and `ronan-eth` have ten `<Head>` call sites between them, and not one of them passes a pathname.** Every page of two live sites would have emitted `<link rel="canonical" href="https://host/">` and `og:url` pointing at the home page. Search engines and share previews would have been wrong everywhere except the landing page.

## Why nothing caught it

- It typechecks. The prop is optional, so its absence is legal at every call site.
- No test covers it. Neither site has a test that renders `Head` and asserts the URL, and the template's own suite has fourteen tests, none of them about metadata.
- The merge was CLEAN at both sites. `Head.svelte` was not in any conflict list, because both sites had inherited it unmodified.
- The boundary test went GREEN, which is the part worth sitting with. The rule was satisfied precisely BECAUSE the coupling had been removed, and removing it is what broke the behaviour.

It was found by reading the descendants' call sites while resolving an unrelated conflict, which is luck dressed up as diligence.

## The actual lesson

**A boundary rule measures imports, and imports are not behaviour.** `framework-boundary.test.ts` can tell you that `Head.svelte` no longer names SvelteKit. It cannot tell you that the value it now receives is the right one, or that anybody is passing it. Making a rule go green by deleting the coupling is exactly as easy as making it go green by fixing the design, and the test cannot distinguish those.

This is the same shape as the tree's existing observation that a clean merge is evidence about text and not about behaviour, one level up: a green boundary test is evidence about imports and not about behaviour.

The corollary for ADR-0005, which proposes moving seven files to satisfy a rule of the same kind: **the move is safe, but only because it is a MOVE.** Relocating a file does not change what it receives. The moment a boundary rule is satisfied by changing an interface rather than changing a path, the descendants' call sites become part of the change and have to be read. Nothing in the rule reminds you of that.

## What was done instead

Reverted. `Head.svelte` reads `page` again, and is recorded in `KNOWN_LEAKS` with the reason and the real fix: a `documentLocation` capability, which the component reads from context so call sites pass nothing and SSR still works. jolly-roger already does exactly this in `core/metadata/Head.svelte`, which is why its own `lib/Head.svelte` was deleted rather than parameterised.

A stated leak with a named fix is worth more than an empty list bought with a silent regression. The stale-entry check means the entry cannot outlive the fix, and that check was verified to fire by removing the import while leaving the entry in place.

## Two things this also surfaced

**`ronan-eth` had five broken imports that no conflict mentioned.** `Breadcrumbs.svelte`, three routes and `RssCallToAction.svelte` imported `route` from `$lib/core/config` and `url` from `$lib/core/utils/web/path`, both of which moved. The merge was clean; `pnpm check` was not. Every node needs verifying whatever the merge said.

**The rule found a real leak in a leaf the moment it arrived.** `conquest-website-2`'s `Header.svelte` calls `goto` for search-result navigation, which predates the rule and is that site's own coupling. Recorded in its `KNOWN_LEAKS` with the shape of the fix rather than fixed mid-cascade. That is the rule doing its job at a node nobody was auditing.
