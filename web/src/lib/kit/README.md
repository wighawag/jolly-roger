# `$lib/kit`: the only place that names SvelteKit

Every import of `$app/*` in this template lives in this directory. Nothing under `src/lib/core` may import it, and `test/framework-boundary.test.ts` fails the build if that stops being true.

This is not portability theatre. The rule pays for itself immediately, in two ways that have nothing to do with ever leaving SvelteKit. A module that takes "where am I deployed" as a parameter can be unit-tested without a framework runtime, and a reader who wants to know what this app assumes about its host has one directory to read instead of a tree to audit.

## What lives here

- `paths.ts`: where the app is deployed. `resolve()` from `$app/paths` bound as a `PathResolver`, plus the pre-bound `url()` and `createRouteHandler()` the app uses. Everything else takes the resolver as a parameter.
- `notification-navigation.ts`: following a URL from a push notification, via shallow routing so a running app is not reloaded.

## How the seam works

`core/` declares what it needs as a type and receives it as a value:

```ts
// core/utils/web/path.ts
export type PathResolver = (path: string) => string;

// core/service-worker/index.ts
export type ServiceWorkerEnvironment = {
	resolvePath: PathResolver;
	navigateTo: (url: string) => void;
};
```

`src/lib/index.ts`, which is where this app is composed, is the one place that hands the two together. Adding a new framework dependency means adding a binding here and a parameter there, which is deliberately slightly annoying: the friction is the point, because it makes the coupling a decision rather than an import.

## What this rule does NOT cover

Be precise about the scope, because a rule that is believed to cover more than it does is worse than one that covers nothing.

- **`$env/static/public`** is a SvelteKit virtual module too. This template reads exactly one variable, `PUBLIC_ENABLE_SW_IN_DEV`, in exactly one file, `routes/+layout.ts`. That is a route, which is the framework's own surface, so it is outside this rule by the same reasoning as the next point. Descendants that grow more `PUBLIC_*` names should watch that it stays that way.
- **`src/routes/**`** is the framework's own surface. Route files are how SvelteKit is addressed at all, and abstracting them would mean reinventing the router.
- **`svelte.config.js`** is not coupling but the deployment decision itself (static output, SPA fallback, relative paths for IPFS). There is nothing to abstract, only something to document, which its comments already do.
- **`import.meta.env`** is Vite's, not SvelteKit's, and survives a move to any other Vite-based tool. `core/service-worker/index.ts` uses it for `DEV`, which is why that file reads dev mode from the bundler rather than taking it as another injected parameter.
- **`src/service-worker/index.ts`** is a SvelteKit-designated entry file, named by the framework and compiled specially. It is the worker, not the app.
