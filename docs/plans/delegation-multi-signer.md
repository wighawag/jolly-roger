# Delegation: many signers, bounded authorisation

Status: steps zero to three done, steps four and five outstanding. Step zero landed in `ba5a28a`; steps one and two shipped from the `etherplay-connect` monorepo as `@etherplay/delegation` 0.1.0, `@etherplay/connect-core` 0.3.0, `@etherplay/connect` 0.4.0 and `@etherplay/openfort` 0.2.0; step three is this repo's working tree.

Scope: `jolly-roger` on `variant/full`, the `etherplay-connect` monorepo, and `template-commit-reveal` as the first downstream adopter.

## Why

This began as one question and turned up a second, larger one.

The question asked: delegation allows one delegate per account, so a second front-end evicts the first, and "replace a signer" and "withdraw a signer" are different operations costing two transactions. Nothing about the mechanism requires the limit, and a membership check costs the same single cold SLOAD as an equality check, so the flexibility looked close to free.

The question found: the delegation signature names no chain and no contract, and it is pre-generated at sign-in without the user being asked. So signing in to any site that uses `@etherplay/connect` hands that site a standing credential it can submit to **any** contract adopting this library, on **any** chain, to act as the owner there. The origin in the signed text does not help, because the only party that reads it is the wallet, and the contract, which is the only party enforcing anything, throws it away.

The two are connected, and the order matters. Today the hole is noisy: a hostile or stale registration evicts the victim's live signer, their other front-end starts reverting, and something visibly breaks. A membership set removes exactly that noise. So shipping the flexibility on its own would make the existing vulnerability quieter without fixing it, which is why this is one change and not two.

## What is decided

### The unit of authority is one contract

Not a scope, not an origin, not a global capability. A delegate authorised at a contract may act for the owner at that contract and nowhere else.

There is no scope key in storage. A capability dimension chosen by the adopting contract (a router passing a per-route constant) was considered and rejected: the library's job is to answer "whose action is this", which is identity, not permission; a route that forgot its constant would silently get the global scope, so the failure mode of the safety feature is no safety and no error; and an adopter that genuinely needs narrower authority already has the documented seam, `_requireAccountForSender`, which is more expressive than a storage key and costs nothing when unused. `UsingDelegation` should say plainly in its docs that the unit is the whole contract, so an adopter knows what it is handing over.

The corollary, which matters more than it looks: **the package ships source, never a singleton deployment.** A shared `DelegationRegistry` that many games point at is not a variation on this design, it is the opposite of it, because the verifying contract in every signature becomes the registry and every credential is valid for every game on it. That sentence belongs in `Delegation.sol` next to the namespaced-storage explanation, because "a registry" is the obvious noun for someone arriving fresh.

### The contract

One mapping replaces the two:

```solidity
enum Status { None, Allowed, Withdrawn }

/// @custom:storage-location erc7201:etherplay.storage.Delegation
struct Layout {
    mapping(address owner => mapping(address delegate => Status)) status;
}
```

The three states are exclusive today and stay exclusive, so one word per pair is faithful rather than a compression: `revoke` sets withdrawn and removes authority together, owner-sent `register` clears withdrawn as a fresh decision, and the signature path refuses to cross it.

Costs move the right way. The hot path is unchanged at one cold SLOAD, since a two-level mapping is one extra keccak (about 50 gas) against a 2100 SLOAD. `canActFor` becomes `status == Allowed`, and the zero-or-self short circuit still costs no SLOAD at all. Revoke drops from about 29k gas (a read plus two SSTOREs) to a single nonzero-to-nonzero SSTORE, roughly 5k.

The external surface goes from seven functions to six:

```solidity
function registerDelegate(address delegate, address payable payee) external payable;
function registerDelegateViaSignature(address owner, address delegate, uint256 deadline, bytes calldata signature) external payable;
function revokeDelegate(address delegate) external;
function delegationStatus(address owner, address delegate) external view returns (bool allowed, bool withdrawn);
function delegationMessage(address delegate, uint256 deadline) external view returns (string memory);
function delegationDigest(address delegate, uint256 deadline) external view returns (bytes32);
```

`delegateOf` disappears. Under a set it can only be answered by the logs, and returning any single address would be a lie. Every caller only ever asked about a pair anyway: `isRegistered` in the web client compared `delegateOf(owner)` against its own signer and threw the address away, then made a second call for `delegationWithdrawn`. One call now answers both, which halves the poll.

`delegationStatus` returns two bools rather than the raw enum. Same single SLOAD, but it keeps magic numbers out of `IDelegation`, out of the client ABI, and out of every consumer that would otherwise have to remember whether 2 means withdrawn.

`delegationMessage` and `delegationDigest` become `view` rather than `pure`, because they now read `address(this)` and `block.chainid`.

The deadline is enforced as `deadline == 0 || block.timestamp <= deadline`, with zero meaning no expiry. See below for why zero exists.

### The event is the enumeration API

There is no onchain list of delegates. A linked set was costed and is cheaper than it sounds (the `next` pointer can be the membership word, so the hot path stays one SLOAD, at the price of one extra SSTORE on register and a predecessor walk on revoke), but it was rejected: few delegates are expected, `DelegateChanged` is already indexed on both addresses so `eth_getLogs` gives a per-account query with no indexer, and signer management belongs to the application rather than to the template.

That promotes the event from a notification to the API, so it changes shape:

```solidity
event DelegationChanged(address indexed owner, address indexed delegate, bool allowed);
```

One event rather than an authorise/revoke pair, because reconstruction is an ordered replay of both kinds and a single topic0 is one filter and one decode. Both addresses indexed. The flag unindexed, since nobody filters on it.

Renamed on purpose. The meaning changes from "the delegate is now X" to "X is or is not allowed", so anything still listening for the old topic0 should break loudly rather than quietly mis-read a set as a single value.

The wart to price, and it belongs to the app rather than the library: many public and wallet-supplied RPCs cap `eth_getLogs` ranges (10k blocks is common, some refuse `fromBlock: 0`), so a fresh browser reconstructing the set from genesis needs a stored deployment block and paging.

### The message

`origin` comes out. The wallet always knows the true origin of the page asking, so it never needs the claimed one, and the delegate address already carries the origin binding because it is a pure function of (account key, origin). The text only ever helped a human reading a prompt, and the case this mechanism is built for has no prompt.

Dropping the `Origin:` prefix is also now semantically required, not merely tidy. Under the etherplay convention that prefix tells a conforming wallet "this is safe to sign without asking". That is exactly the property being removed. Auto-signing now comes from the host's allowlist decision, not from the shape of the message, so a wallet implementing only the origin rule must fall through to prompting.

The chain and the contract go in, supplied by the contract itself from `address(this)` and `block.chainid`, so neither is attacker-supplied. Behind a router `address(this)` is the proxy, which is the unit of authority above.

```
IMPORTANT: Only sign this on a site you trust.

This authorizes another address to act in your name onchain, at one contract.
You can withdraw it at any time by revoking it there.

Delegate: 0x<delegate>
Contract: 0x<contract>
Chain ID: <chainId>
Expires: <deadline|never>
```

Prose with a labelled field block, borrowing the shape of EIP-4361 and not the standard itself (4361 is built around a domain, a URI and a nonce, all three deliberately absent here). Fields at the bottom, so the first thing a human sees is what they are agreeing to, and so the block cannot be confused with the first-line `Origin:` convention. Everything in fields rather than some in prose, because a wallet must extract the delegate (to compare against the signer it derives) and the contract and chain (to check its allowlist), and one extraction strategy is better than two. Both addresses lowercase, matching `StringUtils.toHexString` and what `connect-core` already does. `Expires: never` stays a line rather than being omitted, since an absent line is easy for a human to miss and easy for a parser to treat as an unset default.

No `Version:` field. Any change to these bytes invalidates every signature anyway, so there is no version negotiation to be had, and a wallet that cannot parse what it sees falls through to showing raw text and prompting, which is the safe default.

Not EIP-712. The readable-dialog argument that shaped the original design is stronger now, not weaker, because this text is about to become something a human is actually shown.

Calldata gets smaller despite gaining a bound: a dynamic `string origin` (offset, length, data) leaves and a `uint256 deadline` arrives. The whole message is still built onchain from small inputs, so its length costs a few hundred gas once at registration and nothing per action.

**This is the artefact that breaks everything silently.** Three implementations must agree byte for byte: the Solidity, the TypeScript builder, and whatever a third-party wallet writes. The pinning test currently lives in `jolly-roger`, which is backwards, and moves with the package.

### Deadlines

The signed text carries a deadline from day one. Adding one later would be a second silent invalidation of every signature in existence, and this is the one wording we want to change exactly once.

Zero means no expiry, and is used for **prompted** credentials for now, because refreshing one costs a popup and re-consent in the middle of someone's game.

**Allowlisted, auto-signed credentials get a real deadline immediately.** They are the ones minted with no human in the loop, and they are the only ones an allowlist entry can produce after that entry turns out to be wrong. Removing an entry stops future auto-signing and does nothing about credentials already issued or delegations already registered, so a date is the only lever anyone has.

The horizon is set by how painful re-authentication is, not by how cheap the signature is. Minting needs the account key, the host is stateless, so a fresh credential means signing in again, which for an email mechanism is another OTP round trip. So: weeks or months, comfortably outliving a remembered session, bounding staleness rather than sessions. If the host gains a session of its own, shorter deadlines become affordable.

### The wallet: `etherplay-connect`

Consent moves to connect time, which is the weakest moment (install-time permissions are the model every platform abandoned), and that weakening is accepted for one reason: a clicked-through consent to a **bounded** grant is a large improvement over no consent at all to an **unbounded** one. The bound does the work, and it lands in the contract where it cannot be clicked through.

The mechanism already exists in the right shape. `AuthState.SignedIn` carries `requireOriginApproval`, and `web/login/src/lib/Login.svelte` enforces approval by **withholding the result**: it only posts back to the opener once approval is not pending. Enforcement is "the app does not receive the thing", not "the app is asked to behave", which is what makes extending it to permissions a payload question rather than a new mechanism.

The extension:

- Permissions are declared by the app at connect time as a list of typed requests, `{type: 'delegation', chainId, contract}`, each marked required or optional.
- Approval is per entry, and the result is reported per entry. A denial must be **reported**, not merely reflected in an absent credential, or the app cannot tell "you declined" from "nobody asked" and will offer the wrong remedy.
- A required entry that is denied fails sign-in. An optional one lets sign-in proceed with that credential missing.
- Unknown permission types are denied and rendered as "this site asked for something this wallet does not understand", never silently dropped, because a silent drop is how an old host and a new app end up disagreeing about what was granted.
- The account object carries the credentials as a list, not a field:

```ts
savedDelegations: Array<{
  chainId: number;
  contract: `0x${string}`;
  delegate: `0x${string}`;
  deadline: number;   // unix seconds, 0 = none
  signature: `0x${string}`;
}>
```

These fields are a **cache of what is inside the signed bytes**, not metadata beside them. If the stored copy disagrees with the signed copy there is no way to notice locally: the signature simply fails to recover. So a failure on the signature path must invalidate the stored credential and request a fresh one rather than being reported as a contract error, which makes any disagreement self-healing. `delegate` is redundant today, since it is always the origin signer, but it makes the record self-describing and catches a mismatch locally instead of onchain.

The allowlist: the host maps origin to a set of `(chainId, contract)` pairs, hardcoded at build time to start. Pairs on the list are auto-signed with no prompt.

The argument for it is not friction, it is that **it does not create authority, it removes a prompt exactly where the prompt was worthless.** An origin on the list can already derive the account's session key silently, because the origin mechanism grants that unconditionally. Auto-signing a delegation bounded to that origin's own contract adds nothing an attacker who compromised that origin did not already have, minus one click-through. The prompt is kept for the case that carries information: an origin asking for a contract that is not its own.

Hardcoded is the safer end of the design, not a temporary shortcut: there is no runtime fetch to poison. When it becomes dynamic, integrity has to come from something signed rather than from a plain HTTP response.

What the allowlist cannot do is revoke. If a game's origin is compromised, removing the entry stops future auto-signing and reaches nobody who already used it. That is what the deadlines above are for.

`originKeyMessage` is **not** changed. It is tempting, since the sign-in text says nothing about acting onchain, but the derived key is `keccak` of the signature over that exact string, so changing it changes every derived signer and therefore every delegate address for every existing user. The disclosure belongs in the permission section instead.

### The package

Delegation moves into the `etherplay-connect` monorepo as its own publishable package, exporting all three faces of the feature:

- the Solidity (`Delegation.sol`, `UsingDelegation.sol`, `IDelegation.sol`), consumed through `node_modules` the way `forge-std` and `@rocketh/proxy` already are;
- the TypeScript message builder, which `connect-core` imports instead of defining `originDelegationMessage` itself;
- the ABI, which `jolly-roger`'s web imports instead of the hand-typed `DELEGATION_ABI` added in `dc40b85`.

The deciding argument is where the agreement test runs. A mismatch between the three is catastrophic and silent, and today the only test pinning any two of them together lives in a downstream template that neither upstream runs in CI. Co-location makes the pinning test run on every change to either side.

Plus a **vectors file**: `(delegate, contract, chainId, deadline)` cases with the exact expected string and digest, covering both deadline branches, a chain id of one and of 31337, and addresses that would be rendered differently by a checksumming implementation.

The ERC-7201 id is renamed from `jolly-roger.storage.Delegation` to `etherplay.storage.Delegation`, with no version segment. A namespace exists to be stable, and a future incompatible layout should be a deliberate new name chosen then. The name has no safety role: each adopter has its own storage, so collisions between adopters are impossible.

Renaming and changing the layout are free right now, and verified so: `contracts/deployments/sepolia/GreetingsRegistry.json` has **no delegation functions in its ABI**, so the delegation work has never been deployed anywhere but local dev chains.

`jolly-roger` stops carrying the library in its own tree, which for a template selling readable, editable source is a genuine loss. It is the right loss: a security-critical library with a consensus message is precisely what you do not want each descendant forking, and `template-commit-reveal` having merged its own copy down is already two copies drifting.

### The app

- Import `DELEGATION_ABI` from the package instead of the local copy.
- `DelegationState` becomes `{allowed, withdrawn}`; `isRegistered` becomes a field read instead of an address comparison; the poll drops to one read.
- `revokeDelegate` takes the signer's address.
- The credential is selected from `savedDelegations` by `(chainId, contract)`, which the app already names in exactly one place, `delegationRegistryAddress` in `context/config.ts`. One value, one place, feeding the chain read, the writers and the lookup.
- Expiry is checked against the browser clock (`createClockStore` is `Date.now()`, nothing chain-derived) with a margin, and the revert path is the real backstop.
- `chooseRegistrationRoute` gains one route, not three:

```ts
| {kind: 're-authorise'; reason: 'denied' | 'expired' | 'not-requested'}
```

One route because the remedy is identical in all three cases, sign in again, and the app can drive it from the Continue button on the consent step, which is already a user gesture and therefore popup-safe. Three reasons because the sentence differs: you declined this, this has lapsed, or this app never asked for this contract, which is a misconfiguration and should say so rather than blaming the user. `unavailable` shrinks back to meaning that nothing the user does from here can work.

Note that live signing is **not** required anywhere in this design. For a hosted account the credential is minted at connect time, so the remedy for every missing or lapsed credential is "sign in again", which is implementable today. Live signing stays a genuine future capability rather than a hole this design has to apologise for.

### `main` carries no delegation

Decided after step three, having been parked until the library became a package. `main` stays the plain template: no delegation, no dependency on the package, `GreetingsRegistry is IGreetingsRegistry, Proxied`. `variant/full` is where the feature lives.

The argument is maintenance, not taste. While the library was source in the tree, "main keeps it" and "main drops it" were both a fork of the same files, and holding the two branches in step was work whichever was chosen. As a package, keeping it would be one dependency and one import, and dropping it costs nothing to maintain: there is no shared source left to drift, so nothing has to be kept in sync by any other means. What dropping it buys is the simpler thing to read and to descend from, which is what `main` is for.

The Sepolia split is a consequence, accepted rather than paid for. Removing `UsingDelegation` changes `GreetingsRegistry`'s bytecode, so the two branches stop sharing a deployment. They were going to diverge the moment `variant/full` moved to the package anyway, and the implementation currently deployed to Sepolia predates delegation on both branches (its ABI has no delegation entry points), so nothing live is disturbed by either branch redeploying on its own.

## Order of work

One change, not two. See "Why" for the reason a partial ship is worse than no ship.

**Step zero, done (`ba5a28a`).** `@etherkit/burner-wallet` 0.0.9, pulling the `personal_sign` fix in `eip-1193-accounts-wrapper` 0.2.0, and the previously skipped e2e test written and green. This is the regression net: the same test green before and after proves the change preserved the round trip, where a test written only against the new design would prove nothing.

**Step one: the package.** Solidity, TS builder, ABI, vectors, pinning test. Nothing consumes it yet. This is the commit where the message is frozen. Gate: vectors green on both sides.

**Step two: `connect`.** `savedDelegations` as a list, the permission section with required and optional entries and per-entry results, the allowlist, deadlines on auto-signed pairs. Gate: a hosted account producing a bounded, dated credential in a dev environment.

**Step three: `jolly-roger`.** Drop `contracts/src/core`, depend on the package, the web changes above, e2e. Gate: the full suite green, including the signature test from step zero, now against the new message.

Done. Three things settled while doing it, none of them a change of design. The delegation permission is declared OPTIONAL, as recommended above. A permission outcome of `unsupported` routes to `unavailable` rather than `re-authorise`, because signing in again cannot teach a wallet a request it does not understand, and `unavailable` is defined here as "nothing the user does from here can work". And since the connect library exposes no way to delete a saved delegation, "invalidate the stored credential" is implemented as a session-scoped set of refused signatures that `credentialState` reads as stale - without which a refusal would only stick for as long as the user stayed on the remedy step.

**Step four: `template-commit-reveal`** merges down. Also the first real test of whether the package boundary works for an adopter that is not this template.

**Step five: `main` sheds delegation.** Remove `contracts/src/core` and its tests, and drop `UsingDelegation` from `GreetingsRegistry`. Contracts only: `main`'s web has carried no delegation UI since `d537e7d`. Independent of step four, so it can happen either side of it. Gate: `main`'s suite green, and each branch deployed to Sepolia on its own from then on.

## Parked, deliberately

**Whether `jolly-roger` marks its delegation permission required.** Settled in step three: optional, for the reason recommended here. The app stays browsable read-only and a denial becomes the `re-authorise` route with reason `denied` rather than a permission wall at the door for something the user cannot evaluate yet. Required remains defensible for a game that genuinely cannot function without it, and the protocol supports both, so the question stays live for an adopter rather than for this template.

**How the host renders a required permission.** If an app may mark one required, the host should render it as "this site will not let you in unless you agree", so the coercion is visible and attributed to the site rather than looking like the wallet's own demand.

**Contract-declared origins.** If a contract published the origins it considers its own front-ends, the host could verify the binding itself instead of relying on a curated list, which would both reintroduce promptless signing without a trust root and make the red warning meaningful (an address and a chain id are not something a person can evaluate). It is a second standard on top of this one, and it puts a mutable list of web origins into or beside a contract.

**Live signing at the host.** Mint on demand rather than at connect time. It is the right move for a general-purpose wallet, it removes the need to declare targets at connect time, and it moves consent to the moment of use, which is where it is worth the most. It also makes short deadlines affordable.

**A host session.** The thing that makes re-authentication cheap, and therefore the thing that decides how short a deadline can be.

## Facts established along the way

Worth recording so they are not re-litigated.

- The Sepolia deployment has no delegation functions: the library has never been deployed, so layout and namespace changes are free.
- `@etherplay/connect` persists the **whole** account object to `localStorage` and `sessionStorage` at the **app's** origin via `saveOriginAccount`, including `signer.privateKey`, `mnemonicKey` and `savedDelegationSignature`. The host is the stateless one.
- The injected-wallet path already sets `savedDelegationSignature: undefined`, with a comment saying the owner is a live wallet that can be asked on demand. Pre-generation is already the exception, for the one mechanism that cannot sign live.
- Signer derivation is `keccak(sign(originKeyMessage(origin)))` with deterministic ECDSA, so any wallet implementing the same rules reproduces the same signer for the same EOA at the same origin. That portability is what makes this a standard rather than an etherplay feature, and it belongs in whatever writes the standard down.
- The e2e suite cannot reach the pre-signed route, because this configuration has no hosted account. It covers the direct route and, since step zero, the live-signature route end to end.
