# `with/embedded-chain`: the chain runs in the tab

> **This file describes a BRANCH of the jolly-roger template tree.** If you are reading it in a repo built from the template - a game, or another template further down - it is describing where your code came from, not where it is. Nothing in it is a statement about the repo you are in.

One capability added to `main`: a WORLD whose chain is an execution-only EVM in the browser, with the app's own contracts deployed onto it by the app's own deploy scripts. A sibling of `with/local-signer`, not a descendant of it.

Named for the CAPABILITY and not for the library. The library has already been renamed once under this tree (`embedded-eth-node` became `webevm`), and a branch name that carries a package name is a rename waiting to happen.

## What is on the branch

| what | where |
| --- | --- |
| the mechanism | `web/src/lib/embedded/` (chain id, node, deploy, deployment records, wallet, world) |
| its tests | `web/test/lib/embedded/` (20: 18 in node, 2 in a browser) |
| **this app's** offline world | `web/src/lib/offline.ts` |
| the demo that shows it | `web/src/routes/offline-demo/+page.svelte` |
| shared files edited | seven, listed below |

## The shared-file budget, which is N1's and is a budget

Every edit to a file `main` also has is a permanent conflict site, so the list is short on purpose and growing it needs a reason.

| file | why | goes up to `main`? |
| --- | --- | --- |
| `core/connection/remote.ts` | `ConnectableChainInfo`, `establishConnectionOn`, `storagePrefix`, `walletConnector`/`useCurrentAccount`, `walletPrompts` | a candidate, once a second world exists upstream |
| `core/connection/types.ts` | `walletPrompts` on `EstablishedConnection` | with the above |
| `core/tab-leader/TabLeaderService.ts` | the election takes a namespace | **yes, and it is a latent correctness fix** |
| `core/tab-leader/storage-lock.ts` | the lock and channel keys carry it | with the above |
| `context/core.ts` | passes the chain id as that namespace | with the above |
| `routes/+page.svelte` | one `<Button>`: the link | no, it is this app's home page |
| `test/lib/core/tab-leader/storage-lock.test.ts` | four tests for the namespace | with the fix |

**The tab-leader rows are a bug fix and not a feature of this branch**, which is why they are marked to go up. The transaction observer runs only while its `TabLeaderService` says this tab leads, and that election used one channel and one lock per ORIGIN. Two contexts in one tab therefore competed, the layout's won, and the world's observer never processed a tick - so a transaction that had mined, with a receipt and a written message, stayed "pending" forever with nothing reported anywhere. An app with one context cannot reach it, which is the only reason it is not already upstream.

## What `/offline-demo` is, and what it deliberately is not

It boots the world, waits, and renders the app's EXISTING `/demo` page inside a nested `<Context>`. The demo component is imported rather than copied on purpose: that the same page works against two worlds without knowing it is the whole claim a world makes, and a second copy would prove nothing.

Measured in a headless chromium against the production build: **264 ms** from page load to a booted world (chain created, deploy run, wallet announced, context built), and **5.7 s** from page load to a MINED greeting, including the wallet picker.

Two things it has to do that only became visible once a second world existed, and both are one line with a long reason:

- **It mounts the world's own `ConnectionFlow`.** `AcrossPages` mounts one in the LAYOUT, bound to the app context, so a nested world's `ensureConnected()` waits on a wallet picker nobody renders. The symptom is a Send button that does nothing and logs nothing.
- **The world's connection gets its own `storagePrefix`.** Both connections persist "the wallet I last used", so sharing the slot means the app auto-reconnects the player as their offline burner on the next load. This is the payment rail's recorded reason, one world further along.

**The player is never asked which wallet to use.** The world hands its connection a `walletConnector` announcing exactly one wallet, holding exactly one account, so there is nothing to pick. That is the honest shape rather than a suppressed dialog: an offline world did not inherit the player's wallet choice, it made one for them, and every other wallet they own has no account on this chain. The wallet is still announced over EIP-6963 so a player can SEE what is signing.

**The world is persisted by default, and so are the pending transactions - which is one decision, not two.** The chain goes to IndexedDB through webevm's adapter and the deployment records through `@rocketh/web`'s store, both namespaced per world, so a reload restores the chain and SKIPS the deploy instead of building a second game beside the first. The operations ledger always persisted, keyed by chain id; what it lacked was a chain to still be about. Not persisting the chain would leave the app holding transactions on a chain that no longer exists.

**Three stores, so a restore is CHECKED before anything is deployed** (`restoreIsCoherent`). Records that outlive their chain make rocketh skip a deploy it believes it has done, and the deploy script then reads a contract that is not there: the boot throws while decoding `0x`, so a check placed afterwards never runs. On a mismatch the world mints a NEW chain id and starts clean, because everything the player kept is keyed by that id.

**No wallet UI, and no modals.** A connection flow exists to relay a wallet's questions - which wallet, which account, approve this - and a wallet this world GENERATED has none. Mounting one produced three modals that flash past describing decisions nobody was making ("Waiting for Wallet Connection", "Please Accept Connection Request", "Getting your transaction ready"); with none mounted, none appear and the send is unaffected. The rule the two states give between them: a nested world using the PLAYER's wallet needs its own flow, and one that brings its own must not have it.

## The three wrappers are GONE, because the packages took the changes

Every adapter in `lib/embedded` was working around a TYPE that had not caught up with what the library underneath already did, and all three libraries are ours. All three shipped, and `wallet.ts` now holds no wrappers at all: `@etherkit/burner-wallet` 0.1.0 takes a provider as its `nodeURL` and an `accountCount`, and `@etherplay/connect` 0.14.0 takes `wallets` directly. The table is kept as a record of what they were, because a wrapper that survives is indistinguishable from a decision and these were not decisions.

| wrapper (now deleted) | why it existed | what deleted it |
| --- | --- | --- |
| `asNodeURL` cast in `wallet.ts` | `initBurnerWallet({nodeURL: string})`, and a chain in the tab has no URL. The implementation already takes either: it builds its RPC with `createCurriedJSONRPC`, which accepts a URL or anything with `.request`. Measured against a webevm node. | widen `nodeURL` to `string \| EIP1193Provider` in `@etherkit/burner-wallet`. No behaviour change. |
| `firstAccountOnly` Proxy | the burner derives `ACCOUNT_COUNT` (10) accounts, and a wallet offering several makes the connection show an account picker. | an `accountCount` (or `accounts`) option on `createBurnerWalletProvider`. The derivation already takes an index. |
| `SoleWalletConnector` | the connection's universe of wallets comes from EIP-6963 announcements on `window`, and a world's wallet is not an ambient page wallet. | let `createConnection` take the wallets directly - `wallets: WalletHandle[]`, or an `only` - so supplying one needs no connector subclass. |

**And the fourth item, which was not a wrapper, is the valuable one and it also shipped.** `WalletInfo.autoApproves` lets a wallet declare that it answers by itself, and `@etherplay/connect` acts on it by not announcing a `PendingRequest` for such a wallet. Measured here: with a connection flow mounted, that removes "Getting your transaction ready" entirely. What it does NOT remove is the connect step - "Waiting for Wallet Connection" and "Please Accept Connection Request" still flash, because those render a STEP rather than a request, and connecting a wallet that answers itself is instantaneous. So this route still mounts no flow, and the remaining half is a small change wherever a flow lives: skip the connect modal when `walletPrompts(info)` is false, since there is nothing for the user to accept.

The app still carries `walletPrompts` on `EstablishedConnection`, and it is not redundant: `guardDispatch` is applied ONCE when the client is built, so it needs a static answer, while `connection.wallet.info` is a store that changes with the wallet. For a world the answer is static by construction. An app whose remote connection could select an auto-approving wallet would want the dynamic version, and that is a different change.

What it does not do is fix the chrome. In the same screenshot the page transacts on the embedded chain while the navbar offers "Connect" for the remote one and a banner reports that RPC as down. The page says so in a strip above the demo, which is honesty rather than a fix; see the trap at the end of this file.

**The mechanism is in `lib/` and any route is only its demo.** This is not tidiness. A descendant of this template deletes the demo routes it inherits (`template-commit-reveal` deleted `web/src/routes/demo/` and pays for it with a recurring `CONFLICT (modify/delete)` on every merge), so anything world-building written inside a route is thrown away by the repos that most want the world. What a route may hold is the choosing: a page that says "play offline", boots a world and provides it.

## The one shared file it edits, and why it is one rather than three

`core/connection/remote.ts` gains three things and changes nothing:

- `ConnectableChainInfo`, the chain a connection is made TO, which is either an endpoint or a provider. `@etherplay/connect`'s `ChainInfo<P>` has always been `{rpcUrls}` OR `{provider}`; this names the same choice in this app's own vocabulary so that WHERE the chain runs is not a second way to authenticate.
- `establishConnectionOn({chainInfo, deployments, ...})`, which is `establishRemoteConnection` with the two world-shaped facts taken out. The remote factory is now three lines on top of it and behaves identically.

- `storagePrefix` on `ChainConnectionOptions`, forwarded to `createConnection`. Not tidiness: every connection persists "the wallet I last used", and two sharing the slot reconnect as each other. `createPaymentConnection` already had its own for exactly this; a world needs one for a sharper version of it, since the two chains do not even have the same accounts.

It is an EXTRACTION rather than a second copy on purpose. The fault injection, the two derived stores and the exact shape of `EstablishedConnection` are things every world has to get identically, or the app behaves differently depending on which world it is pointed at. A second copy is the input-recogniser failure this tree has already paid for twice.

It is a plausible candidate to go up to `main` later, which would take this branch's shared-file edit count to zero. It has not, because on `main` it would be a seam with one implementation.

## The divergence ritual

`check-shared-divergence.sh` lives on the local `tooling` orphan branch. Run it from any checkout:

```sh
# this branch against main, over the DEFAULT watch paths
FEATURES="with/embedded-chain" \
ALLOWED="web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

# and over the whole of core/, which is where this branch's other edits are
WATCH="web/src/lib/core" FEATURES="with/embedded-chain" \
ALLOWED="web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts web/src/lib/core/tab-leader/TabLeaderService.ts web/src/lib/core/tab-leader/storage-lock.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

# and the runs that prove the rest are clean because they are IDENTICAL
FEATURES="with/embedded-chain" ALLOWED= \
  bash <(git show tooling:check-shared-divergence.sh)
WATCH="web/src/lib/core" FEATURES="with/embedded-chain" ALLOWED= \
  bash <(git show tooling:check-shared-divergence.sh)
```

Expected: **40 shared files** over the default paths with two allowed differences, and **101** over `core/` with four. Each empty run must name exactly those files and nothing else.

**These are this branch's blocks; the whole tree's are on `tooling`, in `divergence-ritual.md`.** That file carries a block per branch, at three widths, with the counts each last produced - which is what this repo lacked, and what made the script's own `FEATURES` default go two branches stale without anything reporting it.

WATCH THE WIDER PATH AND NOT JUST THE DEFAULT, which this branch is the reason for: the script's default watches `core/connection` and `core/transaction`, and the tab-leader edit is in neither. A branch whose edits fall outside the watched paths has a divergence check that cannot see its own budget.

**And the same instruction found a second one on a branch that had never been run wide.** `with/local-signer` edits `core/ui/faucet/faucet-actions.ts`, which is in neither default path either, so it had no declared budget until 2026-09-20. Read that as evidence for the instruction rather than as a fact about that branch: the default width is not where a shared-file edit is most likely to be, it is only where the first two happened to be.

**Two counts here were wrong and are corrected above, both measured 2026-09-20.** The budget line said five shared files when the table beneath it has listed seven since `types.ts` joined, and the expected `core/` total said 100 against a measured 101. Neither broke anything, which is the point worth keeping: the script counts and this file only describes, so a number in prose beside a checker is the half that rots.

`ALLOWED` is a two-sided contract: everything off it must be identical, and everything ON it must DIFFER. An entry that has stopped differing fails with `ALLOWED BUT IDENTICAL`, which is the script telling you a cascade resolved the branch's own switch in `main`'s favour.

## Two words, and the rule they come from

`embedded-chain` is the MECHANISM and belongs to the framework. `offline` is the EXPERIENCE a player chooses and belongs to the game, exactly as `turn` does. Nothing under `lib/embedded/` says `offline`; a game's launch menu should.

---

# Worlds and identities: how to grow past one connection

> MOVED HERE from `docs/worlds-and-identities.md` on the archived `variant/offline` branch, which was the last survivor of the old `variant/*` naming and held nothing else of its own. Its design is this branch's rationale, so it lives with the branch. The verified facts below are as they were recorded, with a dated correction under each one that measurement has since changed - kept rather than rewritten, because what a claim was worth and what it turned out to be worth are both useful.

The template has exactly one connection: a remote chain, wired in `createContext`. That is deliberate, and this file exists so the first person who needs more does not have to rediscover the shape.

## The two needs are not the same need

Growth past one connection comes in two flavours, and they want different mechanisms.

**An extra wallet role.** The user's account is an email or social login, but they pay from a builtin wallet. Two connections to the _same chain_, differing only in which wallet they prioritise. This is what bomber-world's `paymentConnection` is: the same `chainInfo`, with `prioritizeWalletProvider: true` and `alwaysUseCurrentAccount: true`. It needs a connection and a thin client. It does **not** need `onchainState`, `viewState` or `accountData`, so giving it a whole context would double a store suite to use a fraction of it.

**An extra world.** An offline in-browser chain, or a second network. Everything that describes the world has to follow it, so this needs the full suite, which means a context.

So: **a world gets a context, an identity or wallet role gets a connection.** Conflating them is what makes this look harder than it is.

## The shape a game is likely to want

A menu that instantiates a world. The player picks online (and then a specific network) or offline, and that choice constructs the world's context, much as `createContext` is constructed today.

Alongside it, a long-lived identity connection that is not a world: the main online account, always present, so the app can show what the player owns. That ownership can then influence what an offline world offers, which is precisely why identity must not be scoped to a world.

## The one change that unlocks it

`createContext` currently imports `establishRemoteConnection` and calls it. For a second world to exist, **the connection has to become a parameter**. That is the whole architectural requirement; everything else is composition on top.

It is not done here on purpose. With a single world there is exactly one caller, so injecting it now would be a parameter that exists for nobody, and the template's job is to be readable.

> **DONE, upstream on `main`, 2026-09-18.** `createContext({establishConnection})` takes a `ConnectionFactory` defaulting to `establishRemoteConnection`, and `EstablishedConnection` is the complete list a world supplies, `deployments` included. The objection above was answered rather than ignored: the parameter shipped with a test (`web/test/lib/context/world-connection.test.ts`) asserting that nothing inside `core.ts` reaches for the remote connection behind it. THIS BRANCH IS THAT TEST'S SECOND CALLER, which is what the entry was waiting for.

## Verified facts, so nobody has to re-derive them

- `createConnection` is **synchronous**, and returns at `{step: 'Idle', loading: true}`, resolving into itself in the background. It is safe to construct during SSR (probed in Node: no timers left, process exits).

  > STILL TRUE, and now pinned by `web/test/lib/context/ssr-context.test.ts` rather than by a probe.

- `createConnection` accepts a **provider object** in `chainInfo` (`endpoint: string | UnderlyingEthereumProvider`), and a _deferred_ provider works: constructing is synchronous, and a request issued before the underlying node exists queues and lands on it once ready. This is what would let a world's context exist before its chain does, if that is ever wanted.

  > **THE SPELLING MOVED AND THE CONCLUSION DID NOT SURVIVE, 2026-09-19.** `@etherplay/connect` 0.13's `ChainInfo<P>` is `{rpcUrls}` OR `{provider: P}`; the field is `provider`, and `endpoint` is now an internal name inside the wallet connector. The deferral itself still works and was re-read at the line that does it: the chain info's provider is handed to `createAlwaysOnProvider` as an `endpoint`, and `remote-procedure-call` only ever calls `endpoint.request({method, params})`, per call, lazily. So a provider that queues is fine.
  >
  > **But a deferred provider does not buy what this bullet says it buys, and that is the load-bearing correction.** A world's context cannot exist before its chain, because the thing that blocks is not the provider, it is the DEPLOYMENT RECORDS. `DeploymentsStore.get()` is synchronous by contract and `createCoreContext` reads a contract ADDRESS out of it while constructing, to scope the operations ledger (`operationScopeAddress`). Before the in-tab deploy has run there is no address to answer with, and inventing one keys a player's history to a contract that does not exist. So an embedded world is BUILT asynchronously and its context is constructed synchronously afterwards. ADR-0002 is untouched: the app-level context is still synchronous and SSR-inert, because it is the remote world.

- `embedded-eth-node`'s `chainId` is an **option, not a discovery**, so an embedded world's chain identity is known before the node exists. This is why an embedded chain does not reopen ADR-0002: the async part is availability, not identity.

  > TRUE, and it has a consequence this bullet reads as pure good news. Because the id is an option, every fresh embedded chain would carry the SAME id, and both persistences a player relies on key by it. So the id is MINTED per world (`lib/embedded/chain-id.ts`), from the top 2^20 ids below EIP-2294's `2^53 - 3` ceiling - clear of 1337, of 31337, and of the highest registered chain id there is (2,716,446,429,837,001; chainid.network, 2,763 chains, read 2026-09-19). The genesis hash is NOT the discriminator: genesis is the block before any transaction, so two worlds seeded identically have identical genesis.

- `embedded-eth-node` is **execution-only**: it holds no keys, and `eth_sendTransaction` / `eth_accounts` / `eth_sign` return a real `-32601`. An offline world therefore needs its own in-memory wallet that signs locally and sends `eth_sendRawTransaction`. That wallet is deliberately **not** the player's real account, which has no keys there.

  > TRUE of `webevm` 0.5.0 as well, and the wallet is a BURNER rather than a local signer. The local signer's value is that it is RECOVERABLE (D9): derived from a wallet signature, so the same account re-derives the same key anywhere. In an embedded world the chain and the key die together - a browser that has lost its storage has not lost access to a world, it has lost the world - so there is nothing to recover TO, and the whole D9/D10 recovery family is inapplicable here rather than merely unused.
  >
  > **`@etherkit/burner-wallet` cannot be pointed at the in-tab node yet, and the fix is one line in a package we own.** `initBurnerWallet({nodeURL})` types `nodeURL` as a `string`, and there is no URL for a node that is an object. Its internals already cope: it builds its RPC with `createCurriedJSONRPC(nodeURL)`, and `remote-procedure-call` takes either a URL string or anything with `.request({method, params})`. So the change is to widen the type, not to write code. Until then an embedded world needs its own announced wallet, which is the same code twice and is why this is recorded as the next thing to do rather than done here.

- Persisting an offline world is native: `dumpState` / `loadState` plus `createIndexedDBPersistence`, so "continue where you left off" needs no invention.

  > TRUE. Note what it does NOT cover: the chain persists, and so do the deployment records (`@rocketh/web`'s IndexedDB store), and the SUBMISSION a commit-reveal game holds in localStorage persists separately from both. Three stores, restorable to different points. Minting the chain id is what keeps two worlds' records apart; nothing keeps ONE world's three stores in step, and rewinding a chain under a stored submission is a documented feature of the thing rather than an accident.

## Two traps

**The chrome lies if a world is nested.** Navbar and banners live in `+layout.svelte`, outside any route subtree. A world provided only to a route's subtree leaves the navbar describing a different chain than the page, and `showRpcBanner` (`page.route.id !== '/'`) will complain about a chain the player deliberately is not using. Either a world takes over the app-level context, or the chrome has to be told which world it is describing.

> UNCHANGED AND UNADDRESSED. This is acceptance clause two of the phase that produced this branch, and it is the harder half. The consumers to look at are the ones that read the GLOBAL deployments store rather than the context's: `core/transaction/InsufficientFundsModal.svelte`, `core/utils/ethereum/blockExplorer.ts`, `core/ui/faucet/index.ts`, `ui/pending-operation/operation-actions.ts`, `ui/navbar/navbar.svelte`. Most are in `lib/core`, which every repo in this tree inherits, so fixing them is upstream work with more than one caller to satisfy.

**Account-shaped state follows the world.** `accountData`'s storage key embeds chain id, genesis hash and contract address, so each world gets its own operations history. That is almost certainly what you want, but it is worth knowing rather than discovering.

> TRUE, and it is the half that already worked. The half that did not is a game's own submission storage, which keys by chain id and contract address and NOT by genesis hash - which is why the chain id is minted rather than fixed.
