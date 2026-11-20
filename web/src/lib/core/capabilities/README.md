# Capabilities

Optional, independently-constructable enhancements provided at the app root and
consumed by descendant components. For _why_ this is a separate system from the
app context, see ADR-0001 (`work` branch).

The ADRs live on the `work` orphan branch rather than here, so
`git show work:docs/adr/0001-capabilities-vs-app-context.md` is how to read one.
That is the only place this repository explains the arrangement; everywhere else
just cites the ADR by number.

## Use one

```ts
import {useRoute, useENS, useBlockExplorer} from '$lib/core/capabilities';
const route = useRoute(); // always usable (falls back to base-path resolution)
const ens = useENS(); // ENSService | undefined (pure enhancement)
const explorer = useBlockExplorer(); // BlockExplorer | undefined (no explorer links without it)
```

## Provide at the app root

```ts
import {
	provideRoute,
	provideENS,
	provideBlockExplorer,
} from '$lib/core/capabilities';
provideRoute(route);
provideENS(createENSService());
provideBlockExplorer(blockExplorer); // composed in $lib/index.ts
```

## Define a new one

```ts
import {defineCapability} from '$lib/core/capabilities';

// optional: use() -> T | undefined
const {provide, use} = defineCapability<MyThing>('my-thing');
// fallback: use() -> T (falls back when unprovided)
const c = defineCapability<MyThing>('my-thing', {fallback: () => defaultThing});
// required: use() throws when unprovided
const c = defineCapability<MyThing>('my-thing', {required: true});
```

## Capability vs. app context

- Independently constructable and optional/fallback-able? -> **capability** (here).
- Part of the app's composed, required, async runtime? -> **app context**
  (`$lib/context`, read via `getAppContext()`).
