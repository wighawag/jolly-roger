# Testing Guide

This document describes how to run and write tests for the web application.

## Test Types

### Unit Tests (Vitest)

Unit tests run in isolation and test individual functions, stores, and components.

- **Location**: `test/` directory
- **Pattern**: `**/*.{test,spec}.{js,ts}` (server-side), `**/*.svelte.{test,spec}.{js,ts}` (browser)
- **Framework**: [Vitest](https://vitest.dev/) with [@vitest/browser-playwright](https://vitest.dev/guide/browser/) for component tests

### E2E Tests (Playwright)

End-to-end tests run against the full application with a real Ethereum node.

- **Location**: `e2e/tests/` directory
- **Pattern**: `**/*.e2e.ts`
- **Framework**: [Playwright](https://playwright.dev/)

## Running Tests

### Quick Commands

```bash
# Run all tests (unit + e2e)
pnpm test

# Run only unit tests
pnpm test:unit

# Run only e2e tests
pnpm test:e2e

# Run e2e tests with UI
pnpm test:e2e:ui

# Run e2e tests in debug mode
pnpm test:e2e:debug

# Run e2e tests in headed mode (visible browser)
pnpm test:e2e:headed
```

### Unit Tests in Watch Mode

During development, you can run tests in watch mode:

```bash
pnpm test:unit:watch
```

This will re-run tests when files change.

### Why `test:unit` is two commands

`pnpm test:unit` runs the `server` project and then the `client` project, rather
than letting vitest start both at once. The `client` project drives a real
headless chromium through playwright and the `server` project fans a large
module graph across worker processes, and they compete badly for the machine.

Splitting them is faster even when you have the machine to yourself (25s rather
than 43s here), and it is the difference between finishing and hanging when you
do not: three of these repos running the projects together never completed,
while the same three with them split finish in under two minutes. The reasoning
and the measurements are in `vite.config.ts`.

Watch mode keeps the single-process behaviour on purpose, because that is one
developer on one machine.

## E2E Test Architecture

### Global Setup/Teardown

E2E tests automatically handle:

1. **Worktree**: A throwaway git worktree is created, holding your working tree
2. **Starting Hardhat Node**: A local Ethereum node starts on port 8545 (`E2E_RPC_PORT` moves it)
3. **Contract Deployment**: Contracts are compiled and deployed to localhost
4. **Export Deployments**: Contract addresses/ABIs are exported to the web app
5. **Build Web App**: The SvelteKit app is built for localhost
6. **Verify**: Each address the build shipped must be a contract on this run's chain
7. **Cleanup**: Node is stopped, report is copied back, worktree is removed

### The run happens in a git worktree

Everything from step 3 on writes a file that a running `pnpm start` session is
also using:

| file                         | who else writes it                                  |
| ---------------------------- | --------------------------------------------------- |
| `contracts/generated`        | `compile`; `deploy:watch` **watches** it and reacts |
| `contracts/deployments/*`    | every deploy, keyed by chain                        |
| `web/src/lib/deployments.ts` | every export; a dev server hot-reloads from it      |
| `web/build`                  | every build                                         |

Sharing them means the two runs corrupt each other, in both directions. The e2e
run deploys to a chain it deletes at exit, so its records point a dev server at
contracts that no longer exist - and since the records carry that chain's
genesis hash, the developer's next deploy sees a mismatch, wipes them and
redeploys, discarding the deployment they had. Conversely a dev session's
`deploy:watch` fires on any write under `contracts/generated`, deploys to ITS
chain and rewrites the records and the exported module mid-run, so the app gets
built against the wrong chain.

So `scripts/run-e2e-tests.sh` runs in `$TMPDIR/<repo>-e2e-worktree`
(`E2E_WORKTREE_DIR` moves it), and nothing in the app or the contracts config
has to know that e2e exists.

The worktree holds your **working tree**, not `HEAD`: uncommitted changes are
applied as a patch, untracked-but-not-ignored files are copied, and so are the
two kinds of ignored input a build needs (`.env*.local` and the generated PWA
icons). `node_modules` is symlinked rather than installed again - same commit,
same lockfile, and pnpm's links resolve relative to their real path.

- `E2E_KEEP_WORKTREE=1` leaves it in place to poke at afterwards.
- The Playwright report and `test-results` (traces, screenshots) are copied back
  into `web/` before it is removed, so a failed run is still debuggable.

Also worth knowing: the deploy runs with `--no-compile`, because the compile
step already ran with the default build profile and the deploy task would
otherwise compile everything again with `production` - two full compiles per
run, and deployed bytecode that is not the bytecode just built.

The verify step exists because every setup mistake in this area fails the same
way: the app holds an address with no code on it, reads return `0x`, and the
suite fails several tests deep with "Failed to load messages", which looks like
an app bug rather than a setup one.

### Test Fixtures

Tests can use custom fixtures for common operations:

```typescript
import {test, expect} from '../fixtures/test';

// Using connectedPage fixture - wallet is pre-connected
test('submit greeting', async ({connectedPage}) => {
	await connectedPage.getByPlaceholder('Enter your greeting...').fill('Hello!');
	await connectedPage.getByRole('button', {name: /send/i}).click();
	// ...
});

// Manual wallet connection
test('connect manually', async ({page, connectWallet}) => {
	await page.goto('/demo');
	// ... trigger connection modal ...
	await connectWallet(page);
});

// Wait for transactions
test('wait for tx', async ({connectedPage, waitForTransaction}) => {
	// Submit something
	await waitForTransaction(connectedPage);
});
```

## Writing Tests

### Unit Test Example

```typescript
// test/lib/mymodule.test.ts
import {describe, it, expect, vi} from 'vitest';
import {myFunction} from '$lib/mymodule';

describe('myFunction', () => {
	it('should do something', () => {
		expect(myFunction()).toBe(true);
	});
});
```

### Component Test Example

Component tests run in a real browser (the `client` project). Name them
`*.svelte.test.ts` so Vitest routes them to the browser project. Prefer
components with deterministic, prop-driven rendering (display components);
leave wallet-connect / tx-submission / funds-modal flows to E2E.

```typescript
// test/lib/core/ui/ethereum/Address.svelte.test.ts
import {describe, it, expect, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';

// SvelteKit's generated `$env/*` modules are not available in the raw browser
// test runtime. If the component (or its import chain) reads them, stub them:
vi.mock('$env/dynamic/public', () => ({env: {}}));
vi.mock('$env/static/public', () => ({PUBLIC_USE_INTERNAL_EXPLORER: 'true'}));

import Address from '$lib/core/ui/ethereum/Address.svelte';

describe('Address.svelte', () => {
	it('truncates the address by default', async () => {
		const screen = render(Address, {
			value: '0x1234567890abcdef1234567890abcdef12345678',
		});
		await expect.element(screen.getByText('0x1234...5678')).toBeInTheDocument();
	});
});
```

### E2E Test Example

```typescript
// e2e/tests/mypage.e2e.ts
import {test, expect, describe} from '../fixtures/test';

describe('My Page', () => {
	test('should display title', async ({page}) => {
		await page.goto('/mypage');
		await expect(page.getByRole('heading')).toContainText('My Title');
	});

	test('should interact with wallet', async ({connectedPage}) => {
		// connectedPage already has wallet connected
		await connectedPage.getByRole('button', {name: 'Submit'}).click();
		// ...
	});
});
```

### Best Practices

1. **Use semantic selectors**: Prefer `getByRole`, `getByText`, `getByPlaceholder` over CSS selectors
2. **Avoid arbitrary waits**: Use `waitFor` with conditions instead of `waitForTimeout`
3. **Test user flows**: E2E tests should mimic real user behavior
4. **Isolate tests**: Each test should be independent
5. **Generate unique data**: Use timestamps for unique test data

## Test Configuration

### Playwright Config

See `playwright.config.ts` for full configuration including:

- Test directory and patterns
- Browser settings (Chromium by default)
- Timeouts (60s for tests, 10s for assertions)
- Retry configuration
- Report generation

### Vitest Config

See `vite.config.ts` for test configuration including:

- Browser vs server test projects
- Require assertions mode
- Include/exclude patterns

## CI/CD

Tests run automatically on GitHub Actions:

- **Push to main**: All tests run
- **Pull requests**: All tests run

The workflow includes:

1. **Unit Tests**: Fast, run in parallel
2. **E2E Tests**: Starts Hardhat node, deploys contracts, runs browser tests
3. **Contract Tests**: Solidity tests via Hardhat

### Artifacts

- Playwright HTML report is uploaded for all runs
- Test traces are uploaded on failure for debugging

## Troubleshooting

### E2E tests failing to start node

If the Hardhat node fails to start:

1. Check what is on the port: `lsof -i :8545`. It may be a chain you (or another
   project) are using - the run reuses an existing node rather than taking it
   down, and neither should you.
2. Move the run instead: `E2E_RPC_PORT=21545 E2E_PORT=21473 pnpm test:e2e`.
3. Try running the node manually: `pnpm contracts:node:local`

### Tests timing out

Blockchain operations can be slow. If tests time out:

1. Increase timeout in `playwright.config.ts`
2. Check if the node is responding: `curl -X POST http://localhost:8545`
3. Check logs in CI artifacts

### Wallet connection failing

If wallet connection fails in tests:

1. Ensure the app is built for localhost: `pnpm build localhost`
2. Check that `PUBLIC_USE_BURNER_WALLET` is set in `.env.localhost`
3. Verify the Dev Mode button appears in the connection modal

### "Failed to load messages" / reads returning `0x`

The app is holding a contract address that has no code on the chain it is
talking to. The run's verify step should catch this before the tests do. Re-run
with `E2E_KEEP_WORKTREE=1` and compare three things inside the worktree:

1. The address in `web/src/lib/deployments.ts` (what the build shipped).
2. The address in `contracts/deployments/localhost/GreetingsRegistry.json` (what
   the deploy recorded).
3. `eth_getCode` for it on `E2E_RPC_URL` (what the chain has).
