# Web Frontend - Developer Guide

This guide covers the architecture, patterns, and conventions for contributing to the web frontend.

## Quick Links

- [Architecture Overview](#architecture-overview)
- [Code Patterns](#code-patterns)
- [Folder Structure](#folder-structure)
- [Adding New Features](#adding-new-features)
- [Testing](#testing)

---

## Architecture Overview

### Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn-svelte
- **State Management**: Svelte stores + custom store factories
- **TypeScript**: Strict mode enabled

### Key Concepts

1. **Dual-Store Architecture**: Each feature has a main data store + status store (loading/error/lastSuccessfulFetch)
2. **Context Pattern**: Services built synchronously by `createContext()` and provided through `Context.svelte`
3. **No Globals**: Browser APIs guarded with `typeof window === 'undefined'` checks
4. **Svelte 5 Runes**: Uses `$state()`, `$derived()`, `$props()` instead of legacy reactive declarations

---

## Folder Structure

```
src/
├── lib/                      # Shared libraries
│   ├── core/                 # Business logic (no UI dependencies)
│   │   ├── connection/       # Wallet/RPC connection
│   │   ├── transaction/      # Transaction handling
│   │   ├── ens/              # ENS resolution
│   │   ├── notifications/    # Notification system
│   │   ├── service-worker/   # Service worker logic
│   │   ├── tab-leader/       # Multi-tab coordination
│   │   ├── clock/            # Time utilities
│   │   └── utils/            # Pure functions
│   │       ├── data/         # Data manipulation
│   │       ├── ethereum/     # Ethereum utilities
│   │       ├── format/       # Formatting utilities
│   │       ├── tailwind/     # Tailwind helpers
│   │       └── web/          # Web utilities
│   ├── context/              # Svelte context providers
│   │   ├── Context.svelte
│   │   └── index.ts          # createContext() factory
│   ├── onchain/              # On-chain state management
│   │   ├── onchain-state.ts  # Main state store
│   │   └── stores.ts         # Derived stores
│   ├── shadcn/               # shadcn-svelte UI components
│   │   └── ui/               # Organized by component type
│   ├── ui/                   # App-level UI components
│   │   ├── navbar/           # Navigation components
│   │   ├── banners/          # Banner components
│   │   ├── modals/           # Modal components
│   │   ├── offline/          # Offline detection UI
│   │   ├── rpc-health/       # RPC health indicator
│   │   └── debug/            # Debug UI (dev only)
│   ├── view/                 # View state derivation
│   │   └── view-state.ts     # Derives view-specific state
│   ├── icons/                # Custom SVG icons
│   ├── metadata/             # SEO/metadata components
│   ├── debug/                # Debug utilities
│   ├── deployments.ts        # Auto-generated contract deployments
│   └── index.ts              # Main exports
├── routes/                   # SvelteKit routes
│   ├── +layout.svelte        # Root layout (context provider)
│   ├── +layout.ts            # Load functions
│   ├── +page.svelte          # Home page
│   ├── +error.svelte         # Error page
│   ├── <feature>/            # Feature routes
│   │   ├── +page.svelte
│   │   ├── components/       # Route-local components
│   │   └── lib/              # Route-local utilities
│   │       ├── services/
│   │       ├── stores/
│   │       └── utils.ts
│   └── ...
├── service-worker/           # PWA service worker
├── app.css                   # Global styles (Tailwind + CSS variables)
├── app.html                  # HTML template
├── app.d.ts                  # TypeScript type extensions
└── web-config.json           # PWA/web configuration
```

### Import Paths

```typescript
// Shared libraries
import {createOnchainState} from '$lib/onchain/onchain-state';
import {getUserContext} from '$lib/context';

// UI components (namespace imports for shadcn)
import * as Card from '$lib/shadcn/ui/card';
import {Button} from '$lib/shadcn/ui/button';

// App UI components
import {Navbar} from '$lib/ui/navbar';
import {PendingOperationBanner} from '$lib/ui/pending-operation';

// Route-local components
import FeatureComponent from './components/FeatureComponent.svelte';
```

---

## Code Patterns

### Svelte 5 Runes

**DO** - Use runes for reactivity:

```typescript
<script lang="ts">
  let { count = $state(0), onIncrement } = $props<{
    count?: number;
    onIncrement?: () => void;
  }>();

  const doubled = $derived(count * 2);

  function increment() {
    count++;
    onIncrement?.();
  }
</script>
```

**DON'T** - Use legacy Svelte 4 patterns:

```typescript
// ❌ Avoid these
export let count = 0;
$: doubled = count * 2;
onMount(() => { ... });
```

### Store Pattern

All stores follow a dual-store architecture:

```typescript
// $lib/onchain/balance.ts
import {writable} from 'svelte/store';

interface BalanceStatus {
	loading: boolean;
	error: Error | null;
	lastSuccessfulFetch: number | null;
}

interface BalanceData {
	value: bigint;
	formatted: string;
	symbol: string;
}

// Status store
export const balanceStatus = writable<BalanceStatus>({
	loading: true,
	error: null,
	lastSuccessfulFetch: null,
});

// Data store
export const balance = writable<BalanceData | null>(null);

// Factory function for creating stores
export function createBalanceStore() {
	// ... initialization logic
	return {balance, balanceStatus};
}
```

### Context Pattern

Services are initialized once and provided via context:

```typescript
// $lib/context/index.ts
export async function createContext() {
	const connectionService = createConnectionService();
	const transactionService = createTransactionService();
	const notificationService = createNotificationService();

	return {
		connection: connectionService,
		transaction: transactionService,
		notifications: notificationService,
	};
}
```

```typescript
// routes/+layout.svelte
<script lang="ts">
  import {createContext} from '$lib/context/index.js';
  import Context from '$lib/context/Context.svelte';
  import InitError from '$lib/context/InitError.svelte';

  let {children} = $props();

  // Synchronous, and constructible on the server too, so the page (and its
  // metadata) prerenders instead of waiting behind a splash.
  const context = createContext();
  const {fatal} = context.context;
</script>

{#if $fatal}
  <InitError message={$fatal} />
{:else}
  <Context {context}>
    {@render children()}
  </Context>
{/if}
```

```typescript
// In a component
<script lang="ts">
  import { getUserContext } from '$lib/context';

  const { connection, transaction } = getUserContext();
</script>
```

### Component Organization

**shadcn components** - Use namespace imports:

```typescript
import * as Card from '$lib/shadcn/ui/card';
import {Button} from '$lib/shadcn/ui/button';
```

**Domain UI components** - Direct imports:

```typescript
import {EthereumButton} from '$lib/core/ui/ethereum';
import {FaucetButton} from '$lib/core/ui/faucet';
```

**App UI components** - Named imports:

```typescript
import {Navbar} from '$lib/ui/navbar';
import {PendingOperationBanner} from '$lib/ui/pending-operation';
```

### TypeScript Conventions

1. **Strict mode enabled** - No implicit `any`
2. **Use interfaces for object types** - Better for extension
3. **Use types for unions/intersections** - More flexible
4. **Export types from dedicated files** when shared across modules

```typescript
// $lib/core/connection/types.ts
export interface ConnectionStatus {
	isConnected: boolean;
	chainId: number | null;
	account: string | null;
}

export type ConnectionEvent = 'connect' | 'disconnect' | 'chainChanged';
```

---

## Adding New Features

### New Feature Checklist

1. **Determine scope**: Does this need global state or is it route-local?
2. **Create folder structure**: Follow existing patterns
3. **Add stores**: Use dual-store pattern
4. **Add components**: Keep them small and composable
5. **Add tests**: Unit tests in `test/`, E2E in `e2e/`

### Example: Adding a New Feature

```bash
# Create route
mkdir -p src/routes/my-feature/components
mkdir -p src/routes/my-feature/lib/{services,stores}

# Create route-local store
touch src/routes/my-feature/lib/stores/my-feature-store.ts

# Create component
touch src/routes/my-feature/components/MyFeatureComponent.svelte

# Create page
touch src/routes/my-feature/+page.svelte
```

```typescript
// src/routes/my-feature/lib/stores/my-feature-store.ts
import {writable} from 'svelte/store';

interface MyFeatureStatus {
	loading: boolean;
	error: Error | null;
}

interface MyFeatureData {
	items: string[];
}

export const myFeatureStatus = writable<MyFeatureStatus>({
	loading: false,
	error: null,
});

export const myFeatureData = writable<MyFeatureData>({items: []});
```

---

## Testing

### Unit Tests

Located in `test/` directory:

```bash
pnpm test          # Run tests
pnpm test:watch    # Watch mode
pnpm test:coverage # With coverage
```

### E2E Tests

Located in `e2e/` directory (Playwright):

```bash
pnpm test:e2e          # Run E2E tests
pnpm test:e2e:ui       # With UI
pnpm test:e2e:debug    # Debug mode
```

### Type Checking

```bash
pnpm check    # Svelte/TypeScript checks
```

---

## Styling

### Tailwind CSS 4

Uses new v4 syntax with CSS variables:

```css
/* src/app.css */
@import 'tailwindcss';

@theme {
	--color-primary: var(--color-primary);
	--font-sans: var(--font-sans);
}

:root {
	--color-primary: #000000;
	--font-sans: Inter, system-ui, sans-serif;
}
```

### Component Styles

- Use Tailwind utility classes
- Avoid custom CSS when possible
- Use `cva` for variant patterns (see shadcn components)

---

## Debug Utilities

### Dev Globals

For development convenience, the following are attached to `window`:

```typescript
// In browser console
window.env; // Environment variables
window.vite_env; // Vite environment
window.get; // Svelte store get function
```

These are stripped in production builds.

### Debug Components

Debug UI components are in `$lib/ui/debug/` and only rendered in development:

```typescript
<script lang="ts">
  import { DebugPanel } from '$lib/ui/debug';
  import { dev } from '$app/environment';
</script>

{#if dev}
  <DebugPanel />
{/if}
```

---

## Common Pitfalls

### 1. Direct Store Mutations

**DO**:

```typescript
count.update((c) => c + 1);
```

**DON'T**:

```typescript
count = count + 1; // ❌ Won't trigger updates
```

### 2. Missing Window Guards

**DO**:

```typescript
if (typeof window !== 'undefined') {
	// Browser-only code
}
```

**DON'T**:

```typescript
const isOnline = window.navigator.onLine; // ❌ SSR will fail
```

### 3. Circular Dependencies

Avoid circular imports between stores. Use dependency injection via context when needed.

### 4. Overusing Runes

Not everything needs to be reactive. Use plain values for static data:

```typescript
// ✅ Fine for static data
const STATIC_CONFIG = {maxItems: 100};

// ✅ Use $state for reactive data
let items = $state<string[]>([]);
```

---

## Code Review Checklist

- [ ] Uses Svelte 5 runes (not legacy patterns)
- [ ] Follows dual-store pattern for state
- [ ] No direct `window` access without guards
- [ ] TypeScript types are explicit (no implicit `any`)
- [ ] Components are small and composable
- [ ] Tests added for new functionality
- [ ] Follows existing code style
- [ ] No unnecessary comments (code should be self-documenting)

---

## Resources

- [Svelte 5 Runes Docs](https://svelte.dev/docs/svelte/v5-migration-guide)
- [SvelteKit Docs](https://kit.svelte.dev/docs)
- [Tailwind CSS 4 Docs](https://tailwindcss.com/docs)
- [shadcn-svelte](https://shadcn-svelte.com/)
