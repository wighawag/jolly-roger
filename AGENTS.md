# setup

`pnpm i`

# frontend

in ./web
for typescript checks: `pnpm check`
for tests: `pnpm test`

## Svelte conventions

- **`.svelte` files must be logic-less or logic-minimal.** They should only render UI and wire props/stores together. Small presentational conveniences are fine (a display formatter, a class toggle, a UI-only animation, local open/closed modal state). Anything else, business/domain logic, async calls, data fetching/derivation, non-trivial computation, filtering/sorting/aggregating domain data, network error handling, belongs in a plain `.ts` module (a helper, a store, or a service) that the component imports.

- **Never create `.svelte.ts` files.** Do not use Svelte runes (`$state`, `$derived`, `$effect`, ...) outside of `.svelte` components. Put reusable logic in plain `.ts` files and expose reactivity with Svelte stores (`writable`/`readable`/`derived` from `svelte/store`). Components consume those stores with the `$store` syntax and own any `$effect`/lifecycle wiring themselves.

- Logic lives in `.ts`, reactivity crosses the boundary as stores. Prefer factory functions that return `{subscribe, ...actions}`.

The second of these is checked by `web/test/svelte-conventions-boundary.test.ts`, along with the `.svelte.ts` ban. The first is deliberately left to review: it is about the KIND of code, not its size, and every mechanical proxy for it fires on the wrong things.

## The framework boundary

- **Only `web/src/lib/kit` may import `$app/*`.** Everything under `web/src/lib/core` takes what it needs from the framework as a parameter (`PathResolver`, `ServiceWorkerEnvironment`), and `web/src/routes/**` is exempt because routes are the framework's own surface. `web/test/framework-boundary.test.ts` enforces this, and `web/src/lib/kit/README.md` explains the scope, including what the rule deliberately does not cover.

- **`web/src/lib/index.ts` is where the app is composed**, which is why it is allowed to import both `./kit/*` and the framework. Anything that composes THIS app belongs there rather than in `core/`.

## For descendants of this template

This repo is the root of a template tree; other repos derive from it through a `stem` git remote and inherit `web/src/lib/core` wholesale, in several cases byte-identical. A change that is meaningful for a sibling belongs HERE rather than in the descendant that discovered it, or every sibling silently misses it. The two boundary tests above are stated at this level for the same reason: a rule inherited by every descendant is worth more than the same rule re-derived in each of them.
