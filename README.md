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

Installing also generates `web/src/lib/deployments.ts` from the deployment records committed to this repo, so that `pnpm web:check` and the web unit tests work before you have deployed anything. A repo with no committed records gets it from a throwaway deploy instead, onto a chain that exists only for the length of the install (`contracts/scripts/deploy-ephemeral.ts`): the app type-checks against the real ABIs and deploy parameters, and its addresses are on no chain. That file is gitignored (it names a chain and its addresses, so it belongs to whoever deployed rather than to the repo), and deploying overwrites it: an export for your own chain always wins, and nothing regenerates it while it exists. See `scripts/ensure-deployments.mjs`.

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

## On a LAN box, with no internet

`nix build .#lan` packages the game for [ethereum-lan-node](https://github.com/wighawag/ethereum-lan-node), a box that runs its own chain and serves games to the phones and laptops on its network, with no internet at all. The package is what the box's game module expects: the static site (`$out/web`), built for same-host urls (the chain at `//:8545`, the faucet at `//:34010`, a burner wallet in every browser, no ENS; a repo's own `web/.env.lan` replaces those), and a deploy command the box runs to put the contracts on its chain.

- **The build is ethereum-lan-node's**, not this repo's: `flake.nix` calls its `lib.mkRockethGame` with this repo and `nix/game.nix`, and [its README](https://github.com/wighawag/ethereum-lan-node#a-game-from-the-template-tree) says what it does. A fix to the package lands there and reaches every game with `nix flake update ethereum-lan-node`, without a template cascade.
- **The build has no network.** It compiles with the official solc WASM build, deploys into a throwaway chain with the box's chain id to learn the addresses, and builds the web app against them.
- **The box gets the same addresses**, because every contract goes through the CREATE2 factory the box's genesis predeploys (see "Deterministic deployments" below). The deploy command replays the recorded transactions with `cast`, skipping any contract already there, so the box can run it on every boot.
- **Everything game-specific is in `nix/game.nix`**: the pnpm dependencies' hash (recompute it whenever `pnpm-lock.yaml` changes, as that file says), and optionally the name, title, description, deploy command and a pre-build step.
- **Two hooks stay in this repo**, since nothing outside it can supply them: `path: process.env.SOLC_PATH` in `contracts/hardhat.config.ts`, and `withGuardRecording` in `contracts/rocketh/deploy.ts` (see `contracts/rocketh/guard-recording.ts`).
- **A repo that never goes on a box** drops `flake.nix` and `nix/game.nix`, listed in `.offshoot-omissions`; the two hooks do nothing unless the LAN build switches them on.
- **Add it to a box** as `services.ethereumLanNode.games.<name> = { package = inputs.<this-repo>.packages.x86_64-linux.lan; webPort = <a port of its own>; };`.

Anything the game needs at play time must come from the box: a font, an icon or a proving key fetched from a CDN is a page that breaks there.

**Rehearse it before an event** with `bash scripts/rehearse-lan.sh`: it builds the package and runs it as a box does, on this machine's LAN address (geth from the box's genesis, the package's deploy run twice, the box's faucet, caddy with the box's rule), then runs the e2e suite against it in a browser that can resolve no other host. By default that is `faucet.e2e.ts`, a player starting from an empty burner; name a game's own suites as arguments (`bash scripts/rehearse-lan.sh e2e/tests/<game>.e2e.ts`). The suite funds by transfer there, since geth has no `hardhat_setBalance`. It needs ports 8545, 34010 and 28600 free on that address.

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
        deterministic: true,
      },
    );

    // Interact with the deployed contract
    const contract = env.viem.getContract(deployment);
    const message = await contract.read.messages([deployer]);
  },
  { tags: ["GreetingsRegistry"] },
);
```

### Deterministic deployments

Deploy every contract with `deterministic: true` (for `deployViaProxy`, it covers the proxy and the implementation; for `deployViaRouter`, the routes and the router). It deploys through the CREATE2 factory at `0x4e59b44847b379578588920ca78fbf26c0b4956c`, so an address depends only on the init code and not on the deployer's nonce. That is what lets the LAN package know the addresses before the box's chain exists, and what keeps them when anything else (a faucet paying from the deployer) sends a transaction first. Guard every other transaction a deploy script sends. A setup call (one contract told about another, a role granted) goes through rocketh's `execute` with a `guard`, the view call (or storage slot) that says whether it is still needed:

```typescript
await env.execute(Avatars, {
  account: admin,
  functionName: "setMinter",
  args: [Sale.address],
  guard: { kind: "call", functionName: "minter", equals: Sale.address },
});
```

The deploy skips the call when the guard already holds, so a redeploy repeats nothing, and the LAN package records the guard with the call: the box reads it before replaying the call and checks it after. An unguarded call is refused there, since a box running the deploy on every boot would repeat it. When the value can go to a constructor or to the proxy's `execute` instead, that is simpler still. `nix build git+file://$PWD#lan` checks all of this, and names the transaction it refuses. (A contract test used to check it on every run; it went with the LAN package's move to ethereum-lan-node, and rocketh's `work/notes/ideas/replayable-deploys.md` is the idea that would bring it back.)

Under CREATE2 the deploying contract is the factory, so a constructor must never use `msg.sender` as the deployer (an owner, a mint): pass the account explicitly.

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
