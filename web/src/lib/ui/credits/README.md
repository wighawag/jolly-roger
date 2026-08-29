# Topping up, and the flow that does it

The in-app balance is the gas the browser's own signer spends. This directory is the flow that puts money there: work out who can pay, connect whatever that needs, offer the faucet when the payer is empty, and send. On the first top-up it also registers the signer, in the same transaction.

The reusable half of this lives on `main`, in [`core/funding`](../../core/funding/README.md): who can pay, how much they can send, and the two failures nobody anticipates. **Read that first if you are building a payment of your own.** What is left here is the part that knows what a top-up _is_.

## What is here

**`top-up-flow.ts`** is the state machine, and it is the whole feature. One flow object for the app, held in the context, because three places drive it: the account panel, the insufficient-funds modal when the signer cannot pay, and the demo's Send when the signer is not yet a delegate. Two independent copies would let a user open a second top-up on top of one already running.

**`get-credits.ts`** is the terminal action: the transfer itself, the faucet claim, and the seam a game replaces. Its header is the important document in this directory. It explains why replacing the transfer with a `writeContract` is _not_ the whole of what a game changes, and it is worth reading before you assume it is.

**`payment-methods.ts` used to be here and is now `core/funding/payment-methods.ts`.** It needed no signer and no notion of credits, so it went where a descendant can reach it. It is re-exported from `./index.ts`.

**`credits-view.ts`** derives what the indicator shows. **`TopUpModal.svelte`**, **`CreditsIndicator.svelte`** and **`SignerBalance.svelte`** render; they hold no policy.

## The shape of the flow

`start()` resolves whether this top-up must also register the signer (read fresh from the chain, because it decides both which methods can work and how much gas to keep back), prices the account, and offers the payment methods. The choice screen is **always shown, even when only one method is available**: it is the only place that says why money is being asked for at all.

From there: `choose()` connects a payer, `settle()` lands on either `ready` or `empty`, `claim()` runs the faucet and comes back, and `confirm()` performs. `perform()` picks between an ordinary transfer and a register-and-fund contract call.

Two things run underneath all of it. A **session token** (`session`, `stale()`) means the modal can be closed mid-step without a late-resolving wallet reopening it. A **subscription to the payment connection** follows a wallet that switches account under an open modal, because Rabby exposes one account at a time and the old code went on naming the previous account while offering an amount computed from its balance.

## For a descendant: what to reuse, and where the seam is

A game's onboarding is usually "buy the thing, and fund the signer, in one transaction". Three of the four pieces you need are already written:

- **Who can pay** is `paymentMethods()` from `core/funding`. Do not re-derive a "prefer the account, fall back to a wallet" rule.
- **How much they can send** is `spendableBalance` / `offerAmount`, and `readSendable` if you want the chain reads too. Do not write your own fee multiplier and gas constant.
- **The stale-wallet rule** is `reconcileBalance` (the `knownToHold` argument). You will otherwise meet it as a bug report.
- **The terminal action** is the part that is genuinely yours, and today it is not a parameter: `perform()` branches between `fundOnly` and `registerAndFund`, both of which target the signer. Making it injectable is the outstanding work; the three places it is currently wired in are the gas figure passed to `readSendable`, the `walletRouteBlocked` veto handed to `paymentMethods`, and the route check inside `settle()`.

Whatever you build, wrap the send in `balanceCheck.ensureCanAfford` (`core/transaction/balance-check-store.ts`). It raises the insufficient-funds modal, with the faucet in it, and resumes once the money lands. Skipping it produces a bare "does not have enough funds" where the template would have offered a remedy.

## Rules that are not obvious

**The first top-up is also the registration.** A freshly derived signer holds nothing, and an address that cannot pay for gas cannot do the thing it was just authorised to do. Both register entry points forward `msg.value`, so the two happen in one transaction. That is why `registering` changes the gas reserve: a contract call is not a transfer, and reserving the transfer's gas would size a top-up the payer cannot afford to send.

**A payment proves somebody spent money, never whose account they are.** Paying for somebody is always safe; speaking for somebody never is. This is why a sale in the middle breaks the registration, and why the payment belongs on the delegation-carrying contract. ADR-0003 (`work` branch) has the full reasoning and the rejected alternatives, two of which will be proposed again.

**Cancelling here does not cancel it there.** While the wallet holds a request, Cancel asks first, because the request stays in the wallet and approving it later still sends. In a template the worst case is a registration that lands unnoticed; in a game whose move is a commit, it is a commit the app does not know it has to reveal.

**Dismissing by clicking away is refused while a wallet is thinking.** A wallet takes focus, and the first click back on the page lands outside the dialog. Treating that as "close" tore down runs that had already been signed.

**The amount is never asked for.** A top-up is a fixed purchase, so the flow works out the most it can send and sends that. There is no form to get wrong.
