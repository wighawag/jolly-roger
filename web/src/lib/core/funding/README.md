# Funding and payment

Getting money to where a transaction can spend it, and working out who is able to send it in the first place.

This directory is the reusable half of the top-up flow that ships on `with/local-signer`. It is here, on `main`, because none of it depends on there being a local signer: it is arithmetic about balances and fees, plus the two chain reads that arithmetic needs. **Nothing on this branch imports it.** That is deliberate, and it is the same arrangement as `createPaymentRail` in `core/connection/remote.ts` (see `test/lib/core/connection/payment-rail.test.ts` for the reasoning, which applies here unchanged): an extension point placed upstream for a descendant, with tests on this branch so this branch can tell when it breaks one.

## Read this before you write a payment flow

If you are building an app on this template and you need the user to pay for something, you are about to meet four problems. All four are solved here, and the third and fourth are the ones nobody anticipates:

1. **Who can pay?** The signed-in account may or may not have a wallet; the browser may or may not have one to connect. Both can be missing at once. `paymentMethods` answers this as a list with a reason attached to every unavailable entry.
2. **How much can they send?** Not their balance. Their balance minus the gas of sending, with a safety multiplier, capped by what you are charging. `spendableBalance` and `offerAmount`.
3. **The payer has nothing, so the faucet has to come first.** Then the payer holds money, and the amount you offer has to be sized from what the faucet actually dispensed.
4. **The wallet has not seen the faucet money yet and refuses to sign.** `reconcileBalance`. This one arrives as a bug report, from a user staring at a wallet that says they have nothing while your app insists they have plenty.

The cost of not knowing this directory exists has been measured: a descendant re-derived the payer rule, the fee multiplier and the gas constant, and was about to reimplement the fourth from a bug report, having been told about it as though it were new.

## What is here

**`funding-math.ts`** is every rule, and it is pure. No client, no store, no wallet, so each rule is tested by stating a balance and reading an answer. `gasReserve` (what to keep back, with the multiplier and why it is two), `spendableBalance` (balance minus that reserve, floored at zero), `offerAmount` (the lower of what you are charging and what they can send), `reconcileBalance` (the stale-wallet rule), `checkPayerFunds` (can they cover this exact amount, asked before the wallet is opened), `formatAmount` (rounds down, so a displayed figure never overstates what is sent).

**`sendable.ts`** is those rules with the two chain reads attached, and nothing else. `readSendable` fetches a balance and a fee and applies the rules. It takes a `BalanceReader` rather than finding a client, because this app has two connections answering for different payers and passing the wrong one reads the right address on the wrong chain.

**`payment-methods.ts`** is who can pay, as an enumerable set rather than two hardcoded buttons. Pure. Adding a third way to pay is another entry, not a restructure of whatever renders them.

## What to reuse rather than rebuild

| You need                           | Call                                                         | Do not write                               |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Which payment options to offer     | `paymentMethods()`                                           | A "prefer the account, else a wallet" rule |
| Whether there is any option at all | `availablePaymentMethods()`, `NO_PAYMENT_METHOD_EXPLANATION` | A disabled button with no reason           |
| How much to keep back for gas      | `gasReserve()` / `spendableBalance()`                        | Your own fee multiplier and gas constant   |
| What to charge this payer now      | `offerAmount({ceiling})`                                     | `min(price, balance)`                      |
| Can they afford exactly this       | `checkPayerFunds()`                                          | Letting the wallet discover it             |
| Read a payer end to end            | `readSendable()`                                             | Two awaits and the arithmetic again        |
| Money that just arrived            | `reconcileBalance()` / `knownToHold`                         | Nothing, until a user reports it           |

## When this cascades to a descendant

This directory was extracted from `with/local-signer`, where the same code still lives at different paths. **Because the paths differ, merging `main` down will not conflict**: a descendant silently ends up with two copies and the extraction pays for itself only when the old ones go. Do this once, on each branch that carries `ui/credits`:

1. Delete `src/lib/ui/credits/payment-methods.ts` and `test/lib/ui/credits/payment-methods.test.ts`. Both are superseded verbatim by the copies here. Re-export from `ui/credits/index.ts` so component imports do not move.
2. Delete the pure helpers now duplicated inside `ui/credits/top-up-flow.ts` (`FEE_SAFETY_MULTIPLIER`, `gasReserve`, `spendableBalance`, `formatAmount`) and its private `feePerGas` / `Sendable`, and import them from here. Keep `topUpCeiling` and `maxTopUp` there: they know about `CreditsConfig`, which is what stops them coming up.
3. **One breaking rename.** `blockedFromSignatureRoute?: boolean` is now `walletRouteBlocked?: {reason: string}`. The caller supplies the sentence, because what disqualifies a payer is a property of the action and not of paying, which is what let this file come up to `core/` at all under ADR-0005. The delegation wording that used to live here moves to the `paymentMethods()` call in `top-up-flow.ts`.
4. Stage the deletions before trusting a green run. `test/framework-boundary.test.ts` and `test/svelte-conventions-boundary.test.ts` enumerate with `git ls-files`, so an unstaged deletion still lists a file that is gone and the suite fails on the missing path.

## The two failures nobody expects

**An empty payer needs the faucet before the transfer, not instead of it.** A payer with nothing cannot be shown a price; the next thing that has to happen is funding, and the flow returns to the payment afterwards. Sizing what to send as the _minimum_ of your price and what they can send is what makes a faucet sufficient: a freshly fauceted payer holds exactly the faucet's amount, and `offerAmount` lands under it by the cost of the transaction rather than attempting a fixed price they cannot cover.

**A wallet reports a stale balance straight after being funded.** An injected wallet answers `eth_getBalance` from a cache until it sees a new block, so a read immediately after a faucet claim returns the balance from _before_ the claim. Believing it tells a just-funded user their account is empty and offers a retry that can only re-read the same figure. `reconcileBalance` takes the larger of the chain read and what you watched arrive, and reports `behind: true` when it is doing so, because the transaction is safe to send (nonce ordering takes care of it) but the _wallet_ may still refuse to sign until it catches up. That flag is the difference between a confusing refusal and a sentence explaining it.

## Which parts are pure

All of `funding-math.ts` and all of `payment-methods.ts`. That is where every decision lives, so a payment flow can be tested without a chain, a wallet or a browser. `sendable.ts` is the only file that performs IO, it performs exactly two reads, and it decides nothing.

Keep it that way. If you find yourself adding a branch to `sendable.ts`, the branch belongs in `funding-math.ts` where it can be tested.

## What this does not do

It does not send anything. There is no transaction here, no wallet client, no contract call: the terminal action is the caller's, and the shape of it differs (a plain transfer, a contract call carrying value, a call that also forwards a stipend). What this directory does is decide _whether_ a payer can act and _how much_ they can commit, which is the part that is the same every time.

It does not know what the money is for. `offerAmount` takes a `ceiling` as a plain number, so a template pricing a fixed top-up in credits and a game pricing an item both use it unchanged.

It does not choose a payer, connect a wallet, or drive a UI. On `with/local-signer` the state machine that does all three is `ui/credits/top-up-flow.ts`, and its README describes what a descendant can plug into.

## Where the rest of it lives

`core/connection/gasFee.ts` is the app's fee oracle: `eth_feeHistory` probing, polling, and three speeds with documented headroom. Use it to PRICE a transaction you are about to send. `sendable.ts` does a single unpolled read to SIZE AN OFFER instead, because it must work for a payer on the payment rail that `gasFee` does not track. They are not interchangeable, and stacking them double-counts the headroom: see `FEE_SAFETY_MULTIPLIER`.

`core/ui/faucet` claims from a faucet and reports what it dispensed, which is the `knownToHold` above.

`core/transaction/balance-check-store.ts` has `ensureCanAfford`, which is the _other_ insufficient-funds path: it wraps a transaction you are about to send, and when the sender cannot cover it, it raises the insufficient-funds modal (with the faucet in it) and resumes the send once the money lands. Reach for it around any send that could be short. Writing a bare "does not have enough funds" instead produces a dead end where the template would have offered a remedy.

`core/connection/remote.ts` builds the second connection a third-party payer uses, so that paying is not signing in.
