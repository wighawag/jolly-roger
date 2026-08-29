# Full-Stack Onchain App Template

A production-ready template for building full-stack decentralized applications with [SvelteKit](https://svelte.dev/), [Hardhat v3](https://hardhat.org/), and [hardhat-deploy v2](https://github.com/wighawag/hardhat-deploy) with the [rocketh](https://github.com/wighawag/rocketh) deployment system.

## Why This Template?

This template extends the [template-ethereum-contracts](https://github.com/wighawag/template-ethereum-contracts) to include a fully configured web frontend, providing:

### Smart Contract Development

- **Hot Contract Replacement (HCR)**: The equivalent of HMR (Hot Module Replacement) for smart contracts. Edit your contracts and see changes live while developing your app. This uses proxy patterns with a set of conventions to make it work seamlessly.
- **Intuitive Deployment Scripts**: Write deployment logic in plain TypeScript without learning a new DSL.
- **Flexible Proxy Patterns**: Declarative proxy deployment with `deployViaProxy` for upgradeable contracts.
- **Full Control**: Access to all deployment parameters and lifecycle hooks.

### Web Frontend

- **SvelteKit 5**: Modern, fast, and reactive frontend framework with Svelte 5.
- **Tailwind CSS 4**: Utility-first CSS framework for rapid UI development.
- **PWA Ready**: Pre-configured Progressive Web App with service worker support.
- **IPFS Compatible**: Static adapter with relative paths for decentralized hosting.
- **Auto-Generated Deployments**: Contract ABIs and addresses automatically exported to the frontend.

### Development Experience

- **Zellij Layouts**: Multiple pre-configured terminal layouts for different development scenarios.
- **Live Reload**: Changes to contracts automatically trigger recompilation, redeployment, and frontend updates.
- **Type Safety**: Full TypeScript support across contracts and frontend.

## Design Decisions (ADRs)

The non-obvious decisions in this template are written down, with the options that were rejected and why. The code cites them by number, in the form "ADR-0004 (`work` branch)".

They live on the **`work` orphan branch** rather than in the working tree, so that they never cascade into a fork and never conflict during a template merge. Nothing checks them out; read one with `git show`:

```bash
git show work:docs/adr/                                    # list them
git show work:docs/adr/0004-view-and-system-overlays.md    # read one
```

Start with `0001-capabilities-vs-app-context` (how things are passed down the component tree), `0002-synchronous-ssr-inert-app-context` (why the app context is synchronous and renders on the server) and `0004-view-and-system-overlays` (the two kinds of overlay, and the navigation seam). The same branch holds `work/notes/` : findings, observations and open questions accumulated while building this.

## Project Structure

```
.
├── contracts/                    # Smart contracts package
│   ├── src/                      # Solidity source files
│   │   └── GreetingsRegistry/    # Contract organized by feature
│   │       ├── GreetingsRegistry.sol    # Main contract
│   │       └── GreetingsRegistry.t.sol  # Solidity tests (forge-style)
│   ├── deploy/                   # Deployment scripts
│   ├── deployments/              # Deployment artifacts per network
│   ├── generated/                # Auto-generated artifacts and ABIs
│   ├── rocketh/                  # Rocketh configuration
│   │   ├── config.ts             # Account & extension configuration
│   │   ├── deploy.ts             # Deploy script setup
│   │   └── environment.ts        # Environment setup for tests/scripts
│   ├── scripts/                  # Utility scripts
│   └── test/                     # TypeScript tests
│       └── utils/                # Test utilities
├── web/                          # SvelteKit frontend
│   ├── src/
│   │   ├── lib/
│   │   │   ├── core/             # Reusable building blocks, independent of this
│   │   │   │                     #   app's routes: connection, transaction safety,
│   │   │   │                     #   capabilities, navigation, overlays, notifications,
│   │   │   │                     #   service worker, UI primitives, utils
│   │   │   ├── kit/              # The ONLY place that imports $app/* (see its README)
│   │   │   ├── context/          # The app context: what createContext() composes
│   │   │   ├── account/          # Per-account data, operations, connectors
│   │   │   ├── ui/               # This app's UI: navbar, banners, pending operations
│   │   │   ├── view/             # View models derived from onchain + account state
│   │   │   ├── onchain/          # Contract reads
│   │   │   ├── shadcn/           # Vendored shadcn-svelte components
│   │   │   └── deployments.ts    # Auto-generated contract deployments
│   │   ├── routes/               # SvelteKit routes
│   │   ├── service-worker/       # PWA service worker
│   │   └── web-config.json       # Branding: name, description, icon, links
│   ├── static/                   # Static assets
│   └── svelte.config.js          # SvelteKit configuration
├── dev/                          # Zellij layout configurations
├── package.json                  # Root monorepo configuration
└── pnpm-workspace.yaml           # PNPM workspace definition
```

## Initial Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)

### Installation

```bash
pnpm i
```

Installing also generates `web/src/lib/deployments.ts` from the deployment records committed to this repo, so that `pnpm web:check` and the web unit tests work before you have deployed anything. That file is gitignored (it names a chain and its addresses, so it belongs to whoever deployed rather than to the repo), and deploying overwrites it: an export for your own chain always wins, and nothing regenerates it while it exists. See `scripts/ensure-deployments.mjs`.

We recommend installing [Zellij](https://zellij.dev/) for an optimal development experience with `pnpm start`.

## Quick Start

### Full Local Development

Start everything with a single command (requires Zellij):

```bash
pnpm start
```

This launches:

- A local Ethereum node
- Contract auto-compilation on file changes
- Contract auto-deployment on changes
- Frontend development server with hot reload
- Svelte type checking

### Manual Development

If you prefer running services individually:

1. Start the local Ethereum node:

   ```bash
   pnpm contracts:node:local
   ```

2. In another terminal, compile and deploy:

   ```bash
   pnpm contracts:compile
   pnpm contracts:deploy localhost --skip-prompts
   pnpm contracts:export localhost --ts ../web/src/lib/deployments.ts
   ```

3. Start the web development server:
   ```bash
   pnpm web:dev
   ```

## Usage

### Contract Development

#### Compile Contracts

```bash
pnpm contracts:compile
```

#### Watch Mode (Auto-Rebuild)

```bash
pnpm contracts:compile:watch
```

#### Run Tests

```bash
pnpm contracts:test
```

This runs both:

- **Solidity tests** (forge-style, using `forge-std`)
- **TypeScript tests** (using Node.js test runner with `earl` assertions)

#### Deploy to Networks

1. Configure your environment variables in `.env.local`:

   ```bash
   MNEMONIC_<network>="your mnemonic phrase"
   ETHERSCAN_API_KEY=<api-key>  # For verification
   ```

2. Deploy:
   ```bash
   pnpm contracts:deploy <network>
   ```

#### Verify Contracts

```bash
pnpm contracts:verify <network>
```

### Web Development

#### Development Server

```bash
pnpm web:dev
```

#### Build for Production

```bash
pnpm web:build
```

#### Preview Production Build

```bash
pnpm web:serve
```

### Full Stack Commands

#### Build Everything

Build contracts and web frontend together:

```bash
pnpm build <network>
```

#### Export Contract Deployments

Export contract addresses and ABIs to the frontend:

```bash
pnpm contracts:export <network> --ts ../web/src/lib/deployments.ts
```

## Development Modes

This template provides multiple Zellij layouts for different development scenarios:

### `pnpm start` - Full Local Development

Runs everything locally:

- Local Ethereum node
- Contract compilation, deployment, and TypeScript build (all watching for changes)
- Web development server
- Svelte type checking

### `pnpm attach <network>` - Attach to Existing Deployment

Use when you have contracts already deployed and want to develop the frontend:

- Exports existing deployment info
- Runs web development server

### `pnpm remote-chain <network>` - Remote Chain

Develop against a remote network (testnet/mainnet):

- Watches and deploys to the remote network
- Runs web development server locally

## Configuration

### Named Accounts

Configure accounts in [`contracts/rocketh/config.ts`](contracts/rocketh/config.ts):

```typescript
export const config = {
  accounts: {
    deployer: { default: 0 }, // First account from mnemonic
    admin: { default: 1 }, // Second account
  },
  // ...
} as const satisfies UserConfig;
```

### Network Configuration

Networks are configured in [`contracts/hardhat.config.ts`](contracts/hardhat.config.ts) using helper functions:

- `addNetworksFromEnv()`: Auto-configure networks from `ETH_NODE_URI_*` environment variables
- `addNetworksFromKnownList()`: Add configurations for well-known networks
- `addForkConfiguration()`: Enable forking mode via `HARDHAT_FORK` env var

### Web Configuration

Configure the web app in [`web/src/web-config.json`](web/src/web-config.json). This is the single place to rebrand: `name` drives the landing page hero, the document `<title>`, the social/meta tags, and the PWA manifest, and `pnpm generate-pwa-icons` regenerates the icons from `icon`.

```json
{
  "name": "Jolly Roger",
  "title": "Jolly Roger",
  "description": "Build and Deploy for Eternity",
  "canonicalURL": "http://localhost:8080",
  "repoURL": "",
  "communityURL": "",
  "themeColor": "#000000",
  "icon": "static/icon.svg"
}
```

Replace `icon` (`web/static/icon.svg`) with your own logo; the landing page and every PWA icon derive from it.

`repoURL` and `communityURL` add the source and community links to the navbar. Both default to empty, which hides the link: a fork should point at its own repository, not at this template's. Set them here rather than in `web/src/routes/+layout.svelte`, which is the most-edited file in the template and therefore the most expensive place to park a constant.

### Reference Features

The frontend ships several ready-made routes you can keep, adapt, or remove:

- **Demo** (`/demo`) - the canonical read/write-a-contract example (GreetingsRegistry).
- **Transactions** (`/transactions`) - the pending-operation / transaction tracker UI.
- **Contracts** (`/contracts`) - a generic read/write UI generated from deployed ABIs.
- **Explorer** (`/explorer`) - a built-in block/transaction/address explorer.

These are wired only through links in [`web/src/lib/ui/navbar/navbar.svelte`](web/src/lib/ui/navbar/navbar.svelte) (and the landing page for Demo). To **disable** a feature, remove its link there; to remove it entirely, also delete its folder under `web/src/routes/`. The reusable building blocks live in `web/src/lib/core/` and are independent of these routes.

## Writing Deploy Scripts

Deploy scripts are located in `contracts/deploy/` and are executed in order (prefixed with numbers):

```typescript
import { deployScript, artifacts } from "../rocketh/deploy.js";

export default deployScript(
  async (env) => {
    const { deployer, admin } = env.namedAccounts;

    // Deploy an upgradeable contract
    const deployment = await env.deployViaProxy(
      "GreetingsRegistry",
      {
        account: deployer,
        artifact: artifacts.GreetingsRegistry,
        args: ["prefix:"],
      },
      {
        owner: admin,
        linkedData: {
          /* metadata stored with deployment */
        },
      },
    );

    // Interact with the deployed contract
    const contract = env.viem.getContract(deployment);
    const message = await contract.read.messages([deployer]);
  },
  { tags: ["GreetingsRegistry"] },
);
```

## Using Contracts in the Frontend

Contract deployments are automatically exported to `web/src/lib/deployments.ts`. Import them in your Svelte components:

```typescript
import deployments from "$lib/deployments";

// Access contract address
const address = deployments.contracts.GreetingsRegistry.address;

// Access contract ABI
const abi = deployments.contracts.GreetingsRegistry.abi;
```

## Environment Variables

### Contracts (`contracts/`)

| Variable                 | Description                                   |
| ------------------------ | --------------------------------------------- |
| `ETH_NODE_URI_<network>` | RPC endpoint for the network                  |
| `MNEMONIC_<network>`     | Mnemonic for account derivation               |
| `MNEMONIC`               | Fallback mnemonic if network-specific not set |
| `ETHERSCAN_API_KEY`      | API key for contract verification             |

Set `SECRET` as the value to use Hardhat's secret store:

```bash
ETH_NODE_URI_mainnet=SECRET  # Uses configVariable('SECRET_ETH_NODE_URI_mainnet')
```

### Frontend (`web/.env`, `web/.env.localhost`)

Every one is inlined at build time, so a change needs a rebuild, and every one is PUBLIC: it ships to the browser. Never put a secret or a key-bearing URL in `PUBLIC_CHAIN_INFO_NODE_URL`, which is handed to the user's wallet.

| Variable                              | Description                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_NODE_URL`                     | The app's own RPC. Empty means the app reads the chain only through the connected wallet, and the UI says so instead of reporting a fault. |
| `PUBLIC_CHAIN_INFO_NODE_URL`          | The RPC handed to the WALLET, so it can add/switch to an unknown chain. Deliberately separate from the above, which may be private.        |
| `PUBLIC_WALLET_HOST`                  | Hosted sign-in service. Empty means wallet-only sign-in, which is a supported configuration and not an error.                              |
| `PUBLIC_USE_BURNER_WALLET`            | Node URL to run a dev burner wallet against (`$PUBLIC_NODE_URL` locally). Empty disables it.                                               |
| `PUBLIC_IMPERSONATE_ADDRESSES`        | Comma-separated addresses the burner offers to impersonate. Dev only.                                                                      |
| `PUBLIC_USE_INTERNAL_EXPLORER`        | `true` to link addresses and transactions to the built-in `/explorer` instead of an external block explorer.                               |
| `PUBLIC_EXPLORER_BLOCK_INDEX_ENABLED` | `true` to enable the explorer's block-index listing.                                                                                       |
| `PUBLIC_ENS_NODE_URL`                 | Mainnet RPC used for ENS name and avatar lookups. Empty disables ENS resolution, which is a pure enhancement.                              |
| `PUBLIC_FAUCET_LINK`                  | Faucet URL opened in a popup for the user to claim from.                                                                                   |
| `PUBLIC_FAUCET_API`                   | Faucet HTTP API, claimed from directly when set. Takes precedence over the link.                                                           |
| `PUBLIC_OPERATION_RETENTION_DAYS`     | How long finalized operations stay in local account data.                                                                                  |
| `PUBLIC_ENABLE_SW_IN_DEV`             | `true` to register the service worker during development, which is off by default because it caches aggressively.                          |
| `PUBLIC_ERUDA_PLUGINS`                | Mobile console. Substituted into `src/app.html` at build time rather than read as a module. Empty disables it (fail-closed).               |

## Publishing Contracts as Package

The contracts package can be published for external consumption:

### Package Exports

```json
{
  "exports": {
    "./deploy/*": "./dist/deploy/*",
    "./rocketh/*": "./dist/rocketh/*",
    "./artifacts/*": "./dist/generated/artifacts/*",
    "./abis/*": "./dist/generated/abis/*",
    "./deployments/*": "./deployments/*",
    "./src/*": "./src/*"
  }
}
```

### Building for Publication

```bash
pnpm contracts:build
```

### Usage in External Projects

```typescript
// Import ABIs
import { Abi_GreetingsRegistry } from "jolly-roger-contracts/abis/GreetingsRegistry.js";

// Import deployment info
import GreetingsRegistry from "jolly-roger-contracts/deployments/sepolia/GreetingsRegistry.json";
```

## Linting

### Solidity

Solidity linting is configured with [slippy](https://github.com/astrodevs-labs/slippy):

```bash
pnpm contracts:lint
```

### Code Formatting

```bash
pnpm format        # Format all code
pnpm format:check  # Check formatting
```
