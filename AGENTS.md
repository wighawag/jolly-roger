# setup

`pnpm i`

# frontend

in ./web
for typescript checks: `pnpm check`
for tests: `pnpm test`

## Svelte conventions

- **`.svelte` files must be logic-less or logic-minimal.** They should only
  render UI and wire props/stores together. Small presentational conveniences
  are fine (a display formatter, a class toggle, a UI-only animation, local
  open/closed modal state). Anything else, business/domain logic, async
  blockchain calls, transaction building, balance checks, data
  fetching/derivation, non-trivial computation, filtering/sorting/aggregating
  domain data, network error handling, belongs in a plain `.ts` module (a
  helper, a store, or a service) that the component imports.

- **Never create `.svelte.ts` files.** Do not use Svelte runes
  (`$state`, `$derived`, `$effect`, ...) outside of `.svelte` components. Put
  reusable logic in plain `.ts` files and expose reactivity with Svelte stores
  (`writable`/`readable`/`derived` from `svelte/store`). Components consume
  those stores with the `$store` syntax and own any `$effect`/lifecycle wiring
  themselves.

- Logic lives in `.ts`, reactivity crosses the boundary as stores. Prefer
  factory functions that return `{subscribe, ...actions}` (see the existing
  stores under `src/lib/**` and `src/routes/**/lib/stores/`).

## The framework boundary

- **Only `web/src/lib/kit` may import `$app/*`.** Everything under `web/src/lib/core` takes what it needs from the framework as a parameter (`PathResolver`, `ServiceWorkerEnvironment`), and `web/src/routes/**` is exempt because routes are the framework's own surface. `web/test/framework-boundary.test.ts` enforces this and `web/src/lib/kit/README.md` states the scope, including what the rule deliberately does not cover.

- **`web/src/lib/index.ts` is where the app is composed**, which is why it may import both `./kit/*` and the environment. Anything that composes THIS app belongs there rather than in `core/`.

- The two boundary tests and this section are INHERITED from `template-svelte`, the root of this template tree, where they are also enforced. A change to either that is meaningful for a sibling belongs there rather than here, or every sibling silently misses it.

## Contracts

- **Deploy every contract with `deterministic: true`, and give every other transaction of a deploy script a `guard`** (`execute(..., {guard: {kind: 'call', functionName, args, equals}})`). The LAN package (`nix build .#lan`, see "On a LAN box, with no internet" in README.md) replays the deploy on a box's chain: it needs addresses that depend only on the init code, and a guard to know whether a setup call already happened. The LAN build fails otherwise (no contract test checks it any more, so run `nix build git+file://$PWD#lan` after changing a deploy script). Under CREATE2 a constructor's `msg.sender` is the factory, so never use it as the deployer.
- **The LAN package is built by ethereum-lan-node** (`lib.mkRockethGame`, called from `flake.nix`): change how it builds THERE, not here. A game's specifics go in `nix/game.nix`. Keep the two hooks it needs from this repo: `path: process.env.SOLC_PATH` in `contracts/hardhat.config.ts`, and `withGuardRecording` in `contracts/rocketh/deploy.ts`. Build with `nix build git+file://$PWD#lan` (git add new files first), never a `path:` flake reference.
