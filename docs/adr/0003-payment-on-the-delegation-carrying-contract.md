---
status: accepted
created: 2026-08-14
---

# A game takes its payment on the contract that carries its delegations

A game's onboarding wants one approval for three effects: take the payment, fund the browser's signer, and authorise that signer to act for the account. The first two compose in one transaction already, because a sale can split `msg.value`. The third does not when the sale is a separate contract, since `registerDelegate` takes its authority from `msg.sender` and `msg.sender` at the game is then the sale. **We decided the payment belongs on the delegation-carrying contract**, which makes the buyer the sender at the only place that needs to know who they are.

This is correct ordering rather than a workaround. Only one contract in a call chain is the entry point, and the two candidates have unequal claims on it: a sale is indifferent to who sends (it takes the recipient as a parameter, and reads `msg.sender` only for a free list and an event), while the delegation contract's entire proof is `msg.sender`. Give the slot to the one that needs it.

`template-commit-reveal` is already in this shape without having been told to, staking through `addToReserve` on the same proxy that carries `GameDelegation`, so the problem does not arise for it at all.

## The rule the rejections share

**A payment proves that somebody spent money, never whose account they are.** Consent from an account is evidenced by exactly two things: the account is the sender, or the account signed. Nothing else in a transaction is evidence about it.

In the form an adopter can act on: **paying for somebody is always safe, speaking for somebody never is.** Value flowing to an account needs nobody's permission, because the worst case is a gift, which is exactly why `GameCommit.addToReserve` lets anyone top up anyone's reserve. Authority over an account needs all of it. Every design below that fails, fails by carrying the permissiveness across from the first to the second.

There is also a trilemma worth stating once: no impersonation, the payer need not be the owner, no signature. Pick two. Both useful cells are already free: a player paying for themselves is the sender, so the payment transaction *is* the consent; and when somebody else pays, a hosted account's signature is minted at sign-in with no prompt.

## Considered options

Recorded because two of these will be proposed again, and their cost is invisible from the code that implements them.

- **Authority asserted in a payload.** The purchase carries the account it is for as data and the contract believes it. One transaction, no signature, no new contract, no trust in any *contract*, and it works even for a smart account, which is why it is the most tempting entry on this list. **Rejected: it is impersonation.** The named account is the one the game then displays and records as having acted. The defence that the attacker paid for it prices the capability and ignores the attribution, and a reputational harm has no economic bound. It is also precisely what `Delegation`'s owner-first storage layout exists to prevent, in the stronger direction: somebody else's account answering to an address the attacker controls. Found in the field, with a live instance, in `bomber-world/docs/plans/identity-without-consent.md`, where the price turned out not to be enforced on every path to the sink either.

- **A trusted forwarder (ERC-2771 style).** The game trusts the sale to report the original buyer. Costs one prompt, a 20-byte calldata suffix, no package change (every `UsingDelegation` function is `virtual`, and the library never reads `msg.sender` itself), and it works for every account kind. **Rejected: it hands one contract the permanent ability to register any delegate for any owner**, including clearing a withdrawal, which is only sound when the owner acts directly. Since a sale sits behind a proxy, that means trusting whoever holds its admin key never to upgrade it into something that registers delegates for accounts that never asked. The payload mistake with a contract in the middle, and a breach of the unit of authority being one contract.

- **A generic register-and-forward.** An entry point that registers from `msg.sender`, then forwards value and arbitrary calldata to the sale. **Rejected: an arbitrary-call capability introduced for a specific purpose**, landing on a contract that holds state and often custody, where it becomes `setApprovalForAll` on anything the contract holds. Pinning the target does not save it, because the calldata still steers. Its defensible form is a typed call to a pinned target with arguments the contract encodes itself, which is the decision above with a hop.

- **Inversion: a typed call to a pinned sale.** The buyer calls the delegation contract, which registers from `msg.sender` and then calls the sale with arguments it encodes itself. One prompt, one cold external call plus the registration, no signature verification (so cheaper than the signature route), no new trust, no package change, works for every account kind. **Accepted as the retrofit** when a sale already exists and cannot move. It costs whatever was keyed on the caller downstream: a free list keyed on `msg.sender` at the sale becomes keyed on the game, event attribution flattens, and the path is re-entrant if the sale's mint calls back.

- **Wallet batching (EIP-5792 / EIP-7702).** Two calls in one approval, so the owner is the sender at both contracts and no signature is involved. The simplest value split of all: each call carries its own value. **Not rejected, but not sufficient.** MetaMask offers atomic batching only by prompting the user to upgrade their EOA to a smart account, so the first run asks for a permanent change to their account in order to save one `personal_sign`, and it is unavailable on the chains these games ship on. The fallback is whatever we would have done anyway, so it can never remove the need for another answer. Worth adding later behind `wallet_getCapabilities`, with `atomicRequired` set.

- **Deferring the registration.** Purchase alone, then register at the moment of joining with the signer submitting the credential itself and paying from the gas the purchase gave it. Reaches one prompt for the common cases with no contract changing anywhere, and moves consent to the moment of use. **Left open as a product decision, not adopted.** Its price is a state the client cannot currently reach, paid but not registered, and recovering it from a cold start requires the purchase to leave a trace readable from the account address alone, which a game selling an asset satisfies for free and a template whose "credits" are a gas balance does not.

## Consequences

- Nothing in `@etherplay/delegation` changes for any of this, and nothing in `@etherplay/connect`. The signature path reads no `msg.sender` at any depth, so a credential can be submitted through any number of hops by anybody; and where the owner is the sender, the direct path already works.
- "One prompt" is not one problem. For a native-token sale it is an identity problem, which is what this ADR settles. For a token stake it is an allowance problem, whose answers are different ones (ERC-2612 `permit`, batching, transfer-and-call), and `template-commit-reveal` has the second and not the first.
- A contract account is excluded from the signature route entirely and silently: verification is `ecrecover` with no ERC-1271 fallback, and the app cannot tell that an owner is a contract, so it offers a route that can only fail with `InvalidSignature`. The decision above serves that population, since it is the direct route; a signature-based composition never would.
- `chooseRegistrationRoute` returns `direct` on `ownerCanSend && sameAddress(owner, payer)`, which presumes payment and registration are at the same contract. True under this decision, and false for any adopter that splits them, so the presumption should be made explicit rather than left implied.
