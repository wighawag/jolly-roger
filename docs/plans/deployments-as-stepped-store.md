# Deployments as a stepped store (landing strip for the embedded chain)

Prepares `createContext` for a second connection strategy, `establishEmbeddedConnection`, which runs a full Ethereum node in the browser (`embedded-eth-node`, replacing `embedded-chain`; see `../bomber-world` for the working shape). Implements the reopening clause of ADR-0002 without reopening it.

This plan does **not** implement the embedded strategy. It removes the assumptions that would force that strategy to be async at the root.

## The finding this rests on

The embedded node's asynchrony is about **availability**, not **identity**:

- `createNode(options)` and `createWorkerNode(options)` return `Promise<SlimNode>`, but `chainId` is `options.chainId ?? 31337`. The chain identity is configured, not discovered. bomber-world's `await provider.request({method: 'eth_chainId'})` reads back a value it chose.
- `SlimNode.request` is async by contract, which the package documents as "what lets the SAME object work unchanged on the main thread or across a Worker boundary". A deferred provider is therefore that documented seam, not a workaround.
- What is genuinely runtime is **contract addresses**: bomber-world runs `loadAndExecuteDeploymentsFromModules` at boot, so addresses exist only after the node is up.

So: chain identity stays static, the provider is deferred, and only addresses need a readiness state.

## The split that does the work

`deployments` currently bundles two things with very different lifetimes, and every difficulty here comes from that:

- **chain** (`id`, `genesisHash`, `rpcUrls`, `properties`): identity. Static in both strategies.
- **contracts** (addresses + abis): static in the remote strategy, runtime in the embedded one.

Separating them means only the contract-dependent constructions need gating. Current synchronous readers in `context/index.ts`:

| line | reads | needs |
| --- | --- | --- |
| 131 | `deployments.get().chain` for `resolveAppConfig`, `hasAppRpc`, `resolveSignerRpc` | chain only |
| 207 | `deployments.get().chain` for `buildSignerClient` | chain only |
| 236 | `deployments.get()` for `createOnchainState` | contracts |
| 243 | `deployments.get()` for `createAccountData` | chain **and** contracts |

Two of the four need nothing that is ever runtime. Only `onchainState` and `accountData` do.

## Work

1. **Deferred provider helper** in `core/connection`: `createDeferredProvider(ready: Promise<{request}>)` returning an EIP-1193-shaped object that awaits `ready` per call. Small, and it is what keeps `createPublicClient`/`createWalletClient`/`createConnection` synchronous under the embedded strategy.

2. **Give `DeploymentsStore` a readiness step.** Today it is `Readable<TypedDeployments> & {get(): TypedDeployments}`, always ready. Model the pending state the way the polling stores already do (`{step: 'Unloaded'} | {step: 'Loaded'} & T`) so the vocabulary matches. The remote strategy constructs it already-loaded from the static import, so nothing changes there.

3. **Move the chain out of the pending path.** `chain` should reach `createContext` as configuration, so lines 131 and 207 keep working untouched in both strategies.

4. **Gate the two contract-dependent constructions** on deployments readiness, rather than reading through at construction.

5. **Extend `canReadChain`**, which already exists at `context/index.ts:161-170` and already feeds `chainFetchGate`, `onchainState` and `gasFee`. It currently means "has an app RPC, or the wallet is connected". It gains "...and the chain is ready". This is why the rest of the context needs no new machinery: the gate is already wired everywhere it matters.

6. **Make `EstablishedConnection` per-strategy.** bomber-world's variant carries `paymentConnection`, `paymentPublicClient` and `paymentWalletClient`, an entire second connection for payments. The type must not assume the remote shape.

## Open questions

- **The account-data storage key includes a contract address** (`__private__${chain.id}_${chain.genesisHash}_${contracts.GreetingsRegistry.address}_${account}`). Under the embedded strategy that address is only known post-deploy, so the store's identity depends on a runtime value. Either the key drops the address for that strategy, or `accountData` is constructed once deployments resolve. Worth deciding deliberately, since it decides whether operations survive a reload. Note `embedded-eth-node` does ship `createIndexedDBPersistence`, so a persistent embedded chain is a real option and the answer is not automatically "it is ephemeral, do not care".
- **Does `@etherplay/connect` accept a deferred provider inside `chainInfo`?** bomber-world passes `provider` there. It should only ever call `.request`, but this is the one unverified assumption in the design, so test it before building on it.

## Non-goals

- Implementing `establishEmbeddedConnection` itself.
- Any change to the remote strategy's behaviour. It must come out of this byte-for-byte equivalent at runtime.
- Progress UI for the embedded boot. That is the overlay pattern from ADR-0002 and belongs to the app that needs it; `onNewHead` and the mining config are the natural progress sources.

## Acceptance

- The remote path is unchanged: all current tests stay green, including `ssr-context.test.ts` and the hydration e2e.
- The context still constructs inert off-browser under both strategies, so the embedded configuration keeps prerendering.
- No `await` appears in `createContext`.
