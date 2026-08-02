# Worlds and identities: how to grow past one connection

The template has exactly one connection: a remote chain, wired in `createContext`. That is deliberate, and this file exists so the first person who needs more does not have to rediscover the shape. **Nothing here is implemented.** It is the design space, with the parts that have been verified marked as such.

## The two needs are not the same need

Growth past one connection comes in two flavours, and they want different mechanisms.

**An extra wallet role.** The user's account is an email or social login, but they pay from a builtin wallet. Two connections to the *same chain*, differing only in which wallet they prioritise. This is what bomber-world's `paymentConnection` is: the same `chainInfo`, with `prioritizeWalletProvider: true` and `alwaysUseCurrentAccount: true`. It needs a connection and a thin client. It does **not** need `onchainState`, `viewState` or `accountData`, so giving it a whole context would double a store suite to use a fraction of it.

**An extra world.** An offline in-browser chain, or a second network. Everything that describes the world has to follow it, so this needs the full suite, which means a context.

So: **a world gets a context, an identity or wallet role gets a connection.** Conflating them is what makes this look harder than it is.

## The shape a game is likely to want

A menu that instantiates a world. The player picks online (and then a specific network) or offline, and that choice constructs the world's context, much as `createContext` is constructed today.

Alongside it, a long-lived identity connection that is not a world: the main online account, always present, so the app can show what the player owns. That ownership can then influence what an offline world offers, which is precisely why identity must not be scoped to a world.

## The one change that unlocks it

`createContext` currently imports `establishRemoteConnection` and calls it. For a second world to exist, **the connection has to become a parameter**. That is the whole architectural requirement; everything else is composition on top.

It is not done here on purpose. With a single world there is exactly one caller, so injecting it now would be a parameter that exists for nobody, and the template's job is to be readable.

## Verified facts, so nobody has to re-derive them

- `createConnection` is **synchronous**, and returns at `{step: 'Idle', loading: true}`, resolving into itself in the background. It is safe to construct during SSR (probed in Node: no timers left, process exits).
- `createConnection` accepts a **provider object** in `chainInfo` (`endpoint: string | UnderlyingEthereumProvider`), and a *deferred* provider works: constructing is synchronous, and a request issued before the underlying node exists queues and lands on it once ready. This is what would let a world's context exist before its chain does, if that is ever wanted.
- `embedded-eth-node`'s `chainId` is an **option, not a discovery**, so an embedded world's chain identity is known before the node exists. This is why an embedded chain does not reopen ADR-0002: the async part is availability, not identity.
- `embedded-eth-node` is **execution-only**: it holds no keys, and `eth_sendTransaction` / `eth_accounts` / `eth_sign` return a real `-32601`. An offline world therefore needs its own in-memory wallet that signs locally and sends `eth_sendRawTransaction`. That wallet is deliberately **not** the player's real account, which has no keys there.
- Persisting an offline world is native: `dumpState` / `loadState` plus `createIndexedDBPersistence`, so "continue where you left off" needs no invention.

## Two traps

**The chrome lies if a world is nested.** Navbar and banners live in `+layout.svelte`, outside any route subtree. A world provided only to a route's subtree leaves the navbar describing a different chain than the page, and `showRpcBanner` (`page.route.id !== '/'`) will complain about a chain the player deliberately is not using. Either a world takes over the app-level context, or the chrome has to be told which world it is describing.

**Account-shaped state follows the world.** `accountData`'s storage key embeds chain id, genesis hash and contract address, so each world gets its own operations history. That is almost certainly what you want, but it is worth knowing rather than discovering.
