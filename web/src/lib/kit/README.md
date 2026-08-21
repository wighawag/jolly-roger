# The framework adapter layer

**This directory is the only place in `src/lib` that imports `$app/*`.**

ENFORCED by `test/framework-boundary.test.ts`, which fails on any `$app/*`
import under `src/lib` outside this directory. `src/routes/**` is exempt by
definition: routes are the framework's own surface, and another framework would
replace them wholesale.

The test carries a `KNOWN_LEAKS` list, currently empty. If something genuinely
cannot move yet, add it there with the reason rather than deleting the check;
the test also fails when an entry becomes stale, so the list cannot quietly
outlive the debt.

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
- `paths.ts`: where the app is deployed. `resolve()` from `$app/paths` bound as
  a `PathResolver`, plus the pre-bound `url()` and `createRouteHandler()` the
  app uses. Everything else takes the resolver as a parameter.
- `notification-navigation.ts`: following a URL from a push notification.

## How the rest of the app gets these

Three ways, in order of preference: a **capability** when core components need
it ambiently (`useRoute`, `useDocumentLocation`), a **parameter** when one
caller can supply it (`PathResolver`, `ServiceWorkerEnvironment`), or a **prop**
when a component is rendered by the layout and the answer is the framework's
(`Navbar`'s `currentPath`, `NavigationProgress`'s `isNavigating`).

## What does not

Anything that is really app behaviour. If a module here starts making decisions
rather than translating them, the decision belongs on the other side of the
seam, where it can be tested without a framework.
