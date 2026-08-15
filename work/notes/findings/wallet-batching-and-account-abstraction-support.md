---
title: What wallets and the EVM actually do about batching, 7702 and 4337, checked rather than assumed
type: finding
status: incubating
created: 2026-08-14
source: docs.metamask.io batch-transactions guide and wallet_getCapabilities reference, fetched 2026-08-14; EIP-7702 at eips.ethereum.org, fetched 2026-08-14; an empirical abi.decode test run against solc 0.8.33 via forge/anvil on 2026-08-14; source read of viem 2.55.11, @etherkit/burner-wallet 0.0.9 and eip-1193-accounts-wrapper 0.1.1 as vendored in web/node_modules
---

# Wallet batching, 7702 and 4337, as they actually behave

Gathered while working out whether a game's purchase, signer funding and delegation registration can be one approval (see `docs/adr/0003-payment-on-the-delegation-carrying-contract.md`). All of it is about the world outside this repo, so it is worth keeping with its provenance: any of it can change under us, and the dates above are how current it was.

## `msg.sender` under account abstraction

**EIP-7702: downstream contracts see the EOA's own address.** The delegated code executes in the context of the EOA, and the EIP notes in its rationale that this breaks the invariant that `msg.sender == tx.origin` only in the topmost frame, which is the same statement from the other side.

**ERC-4337: downstream contracts see the smart account's address**, not any owner key behind it. For this stack that is still the right identity, because it is also what the wallet exposes over `eth_accounts` and therefore what the app stores as the account.

So any design resting on "the owner is the sender" holds under both. Why this matters: it is the premise of wallet batching as a way to register a delegate, and it would have been easy to assume 4337 breaks it.

**A contract account cannot use the signature route at all.** `Delegation.registerViaSignature` verifies with `ecrecover` and has no ERC-1271 fallback, so an ERC-4337 account is not merely prompted differently, it is excluded, and the app has no way to detect this in advance.

Unverified and worth checking before relying on it: whether a wallet upgraded under 7702 still answers `personal_sign` with a plain 65-byte ECDSA signature recovering to the same address. It should, since the key is unchanged and only the code at the address is new, but a wallet answering with an ERC-1271 or ERC-6492 wrapper instead would close the signature route silently, surfacing as `InvalidSignature` with nothing saying why.

## EIP-5792 batching in MetaMask

**Atomic batching is an EOA upgrade, not a wallet feature.** `wallet_getCapabilities` reports `atomic` as either `supported` or `ready`, and `ready` means MetaMask will prompt the user to upgrade their account to a MetaMask smart account (an ERC-4337 account, reached via 7702) and only then process the batch. So the first batch a user is offered asks them for a permanent change to their account.

**Only atomic.** MetaMask does not support sequential batching through `wallet_sendCalls`; if the atomic capability is unavailable the call errors rather than degrading. Elsewhere, `atomicRequired: true` is worth setting explicitly, since a sequential batch whose second call fails leaves a half-completed onboarding.

**Withheld from third-party smart accounts.** If the user has already upgraded to a smart account that is not MetaMask's, MetaMask does not currently offer atomic batching for it.

**A fixed network list**, as of the date above: Ethereum, Gnosis, BNB Smart Chain, OP, Base, Polygon, Arbitrum (including Nova), Unichain and Berachain, with their testnets. Notably absent are the fast chains these games ship on: RISE testnet (11155931) and Somnia testnet (50312). If a chain id is not supported, nothing is returned for it.

**Gas:** EIP-7702 charges `PER_EMPTY_ACCOUNT_COST` (25,000) per authorisation, refunded down to `PER_AUTH_BASE_COST` (12,500) when the authority account already exists. Paid once, since the delegation designator persists.

## What the client stack can and cannot do

**viem 2.55.11 ships the 5792 actions**: `sendCalls`, `sendCallsSync`, `getCapabilities`, `getCallsStatus`, `waitForCallsStatus`, `showCallsStatus`. Detection and submission need no new dependency.

**The development burner cannot batch, and never will without work.** `@etherkit/burner-wallet` 0.0.9 handles `eth_requestAccounts` and `eth_accounts` itself and forwards every other method to `eip-1193-accounts-wrapper` 0.1.1, which implements only `eth_sendTransaction`, `personal_sign`, `eth_sign`, `eth_signTransaction` and `eth_signTypedData`. So `wallet_getCapabilities` and `wallet_sendCalls` reach a node that does not implement them and fail. Detection degrades correctly, but any batching path needs a non-burner fallback in development.

## Solidity: `abi.decode` and trailing bytes

`abi.decode(data, (address, address))` returns the first two words and **ignores trailing bytes**, and reverts when the data is too short. Verified empirically against solc 0.8.33: a 64-byte payload and a 161-byte payload decode identically, a 32-byte payload reverts.

Why it matters: an untyped `bytes data` parameter that a contract forwards to somewhere else is a usable side channel for extra arguments (a delegation credential, say) without changing the forwarding contract at all. The constraint is only that the *receiving* end must not enforce an exact length, which is the kind of check that is easy to write and easy to forget is load-bearing.
