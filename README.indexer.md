# `with/indexer`

The node for an app whose state is also built from its events by an etherfold processor: `web/src/lib/indexer/` hosts an app's processor in a worker in the tab (`host.ts`), reads it back with GraphQL, re-reading only what moved (`follower.ts`), and publishes it as one store (`indexed.ts`); `contracts/utils/indexer.ts` runs the same processor in a Node process. The demo counts how many greetings each account has sent, an aggregate over history that no direct read gives, and shows it as a badge beside each message.

```
jolly-roger@main
├─ with/local-signer
│  └─ with/hosted-account
├─ with/embedded-chain
├─ with/indexer          ← here
├─ integration           [with/local-signer, with/embedded-chain]
└─ website
```

**Why from `main`**: indexing is read-only and needs no signer, so an adopter of this node carries no signing layer and no chain in the tab it did not ask for (the service-layers spec, `work/specs/proposed/service-layers.md` on `work`). It is not in `integration`, so it reaches no game by that edge: template-commit-reveal is to take it through a second root of its own, `upstream/with/indexer`, fed from this branch.

**It augments, it never replaces** (the spec's R6): the greetings list is still the poll of `getLastMessages` (`web/src/lib/onchain/state.ts`, untouched), and each message gains an OPTIONAL `greetingCount`, absent while the indexer has not answered, is syncing, or is unreachable, so the page renders as on `main` (R2).

## What the node adds

- `web/src/lib/indexer/`: the framework half, game-agnostic.
  - `host.ts`: the bodies of an app's worker entries. `hostLiveIndexer` for a live chain (ONE TAB INDEXES and the others read, under an election named per deployment; a database per stream; a published snapshot installed when the tab names a publication, the processor then being the published bundle: `processorBundle: {url: new URL('processor.bundle.js', appRoot())}`); `hostWorldIndexer` for a chain in the tab (no election, no publication, its database named by the world).
  - `worker-choice.ts`: which worker a deployment runs and its name (`<prefix>-<chainId>-<address>` live, `<prefix>-world-<chainId>` for a world). Which chains are a world is the app's to say (`indexerWorkerFor(prefix, deployment, address, {isWorld})`); by default none is, since this node has no chain in the tab. `deleteWorldIndex` for a forgotten world.
  - `follower.ts`: one full read, then only the parts whose entities moved, pinned by block HASH so a reorg between the signal and the read is refused and read again rather than composed, serialised so an older answer never lands after a newer one.
  - `indexed.ts`: `createIndexed`, the store an app reads: the follower's last read, the worker's progress, and why the read is not to be trusted (`refused`, `stopped`, a failed `query`, which keeps the last good read), started by its first subscriber in the browser and only while its gate (the app's `chainFetchGate`) is open.
- `contracts/utils/indexer.ts`: `indexInProcess`, the processor in Node over SQLite (libSQL), for tests and scripts. `contracts/utils/in-process-chain.ts`: `deployInProcess`, this repo's contracts deployed by `deploy/` into hardhat's in-process chain, for tests outside the contracts package.
- `web/src/lib/onchain/indexer/`: the app half, the greetings'. `processor.ts` (an entity per account with its greeting count, folded from `MessageChanged`), `source.ts` (GreetingsRegistry, and of its ABI only that event), `queries.ts` (one part, `counts`), `indexer.worker.ts` (the live worker entry), `counts.ts` (`createGreetingCounts`, and `withGreetingCounts`, which lays the counts over the view).
- Tests: `web/test/lib/indexer/` (the follower, the host, the worker choice, the store), `web/test/lib/onchain/indexer.test.ts` (the processor held to the contract: two accounts, three greetings, counts 2 and 1, in Node and through the app's store), `web/e2e/tests/greeting-counts.e2e.ts` (a greeting posted, its badge counted, the next one raising it).

## What it changes from `main`

Each file is in `.offshoot-divergences`, under `[with/indexer]`, with its reason: the composition (`web/src/lib/context/app.ts`: the counts store, and the view wrapped by it), the badge on the demo page (`web/src/routes/demo/+page.svelte`, a few lines), the dependencies (etherfold's packages and libSQL; `fake-indexeddb` and the contracts package for the tests; `web/package.json`, `contracts/package.json`, the lockfile and its `pnpmDepsHash`), and the contracts' `utils/` compiled and built at install.

## How an app uses it

1. Its processor (`declareEntities`, an `on<Event>` handler per event it folds) and its source (its contracts, and of each ABI only the events a handler folds; the source is part of the stream's digest, so it is built in one place).
2. Its questions: the parts of its state, which part each entity's move invalidates, and a `read(execute, parts, {account, at, into})` (`follower.ts`, `StateFollowerSpec`).
3. Its worker entry, about ten lines, because the bundler has to see the processor's import and a literal `new Worker(new URL(...))` in the app's code: `hostLiveIndexer({processor, databasePrefix, finality})`.
4. The store, in its composition: `createIndexed({provider: connection.provider, worker: indexerWorkerFor(prefix, deployments, address), startWorker: (w) => new Worker(new URL('./indexer.worker.ts', import.meta.url), {type: 'module', name: w.name}), source, finality, follower, gate: chainFetchGate})`, read beside the app's direct read.

No snapshot is published here (a demo's history is short); an app that publishes one runs `etherfold build --publish` and points the worker at the bundle.

**Cascade ritual**: `main` into this node. Below jolly-roger it travels through template-commit-reveal's `upstream/with/indexer`, never through `integration`.
