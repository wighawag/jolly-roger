---
title: What a variant edits in core/ is predicted by one thing, and it is not shadcn
type: finding
status: spotted
created: 2026-08-22
source: `git diff --name-status main with/local-signer -- web/src/lib/core`, cross-tabulated against every core module's import list
---

# The line that predicts modification is `getAppContext()`

`core/` carries an implied promise that an adopter should not need to modify it. The usual suspicion is that its shadcn and Tailwind content is what breaks the promise. Cross-tabulating the two lists says otherwise.

## The measurement

`src/lib/core` holds **109 files** (87 `.ts`, 20 `.svelte`, 2 markdown). `with/local-signer` **modifies six** of them and **adds eight**. `with/hosted-account` modifies exactly the same six (it inherits them and adds nothing to `core/`). `website` modifies none.

Measured against `main` at `a64e478`, the tip before this audit's commits. Re-deriving it after they land gives seven and one instead, because `cda104a` edits `core/transaction/README.md` on `main` and the descendants have not yet cascaded it. That extra file is un-cascaded drift from this audit, not a variant edit, and it should drop back out once the tree is in sync.

Seven core files reach the app's composed runtime, by importing `getAppContext` from the `$lib` barrel or the `Context` type from `$lib/context/types`:

```
core/connection/ConnectionFlow.svelte          MODIFIED by the variant
core/transaction/AccountCannotSendModal.svelte MODIFIED
core/transaction/InsufficientFundsModal.svelte MODIFIED
core/ui/faucet/faucet-actions.ts               MODIFIED
core/transaction/ErrorDetailsModal.svelte
core/transaction/InFlightRequestsModal.svelte
core/ui/faucet/FaucetButton.svelte
```

Four of seven, **57%**, are modified. Of the other 102 files, two are modified (`core/connection/mode.ts` and `core/ui/modal/modal.svelte`), which is **2%**. A file that reaches the app context is roughly **thirty times** more likely to be edited by a variant than one that does not.

Against that, the shadcn hypothesis: 15 of the 20 core `.svelte` files import `$lib/shadcn`, and 4 of those 15 are modified (27%); 0 of the 5 that do not import it are modified. The signal exists but it is entirely confounded, because all six context-reaching components also import shadcn. Tailwind is weaker still (17 of 20 carry a `class=` attribute). And `$env/static/public` reaches only four core files (`ens/index.ts`, `utils/ethereum/blockExplorer.ts`, `ui/faucet/index.ts`, `ui/faucet/FaucetButton.svelte`), **none** of which any descendant has ever modified.

So the UI kit is not what makes a core file get edited. Reaching the app's runtime is.

## Why that is the causal answer and not a coincidence

A component that calls `getAppContext()` reads whatever the app happens to have composed. When the variant changes the composition, adding `signerExecutor`, `signerBalance`, `topUp`, `delegation`, `hasLocalSigner`, every component that reads the composition has to change with it. Read the four diffs and they are all exactly that:

- `InsufficientFundsModal.svelte` destructures `{balanceCheck, accountExecutor, topUp}` instead of `{balanceCheck}`, and grows a second remedy ("top up the in-app balance") beside the faucet button, because in the variant the account that is short is not the account the faucet can fund.
- `ConnectionFlow.svelte` appends two OAuth buttons to the sign-in list.
- `AccountCannotSendModal.svelte` changes only the dev-facing hint prose, because in the variant the advice is different ("send it through `signerExecutor`" rather than "there is no fix here").
- `faucet-actions.ts` takes an optional `target` address and returns what was dispensed.

Those are not four separate design misses. They are one: **these files are app UI wearing a `core/` path.** They are indistinguishable in kind from `lib/ui/pending-operation/PendingOperationModal.svelte` or `lib/ui/rpc-health/RpcHealthBanner.svelte`, eight of whose nineteen files also call `getAppContext()`. `lib/ui` is already the directory for "components that read this app's runtime". Seven files are on the wrong side of a line that already exists.

## The variant's own instincts already agree

The strongest corroboration is what `with/local-signer` ADDED to `core/`, because nobody was telling it where to put things:

```
core/connection/credits.ts        imports only a type from deployments-store
core/connection/signer-rpc.ts     imports only ./mode
core/connection/wallet-account.ts imports nothing
core/ui/confirm/confirmation.ts   imports only core/ui/overlay
core/ui/layers.ts                 imports nothing
core/ui/oauth/GoogleIcon.svelte   markup only
core/ui/oauth/FacebookIcon.svelte markup only
core/ui/confirm/ConfirmationModal.svelte   imports getAppContext from $lib
```

Seven of the eight are genuinely portable and belong exactly where they were put. The eighth, the one that reaches the app context, is a modal. An independent author, given no rule, put portable things in `core/` and one app-coupled modal in `core/` by mistake. The rule this suggests is one people are already following by feel, which is the cheapest kind of rule to adopt.

## The two exceptions, and why neither weakens the rule

**`core/connection/mode.ts`** is modified by design. `TARGET_STEP` is documented as "THE ONE LINE a descendant changes to gain or drop the signer", and it is in source rather than env deliberately, so that the comparison against it stays statically analysable and the unused branch can be eliminated. Its two historical conflicts were one-line resolutions. This is a working extension point that happens to be spelled as an edit. Leave it alone.

**`core/ui/modal/modal.svelte`** is modified because the two branches independently invented different answers to overlay paint order: `main` passes `portalProps={{to: '#--layer-modals'}}` at the call site, the variant made it `Dialog.Content`'s default and drives everything from `core/ui/layers.ts`. That is already recorded in `work/notes/observations/two-layer-schemes-met-in-the-cascade.md`, with the right fix (backport `layers.ts` and its test to `main`, since they were landed below their home). It is a home-of-the-change problem, not a boundary problem.

Strip those two out and the story is clean: **every core file a variant has ever modified for a variant reason is a file that reads the app context.**

## What it costs and who pays

Modestly, today. Those six files account for 13 conflict events out of 65 across 44 merges (see the merge-tax note), and none of them individually conflicts more than twice. The cost is not primarily merge pain, it is **that `core/` does not mean anything**. An adopter cannot look at the directory and know what is safe to keep, a variant author cannot know where to put a new file, and the promise the name makes is one nothing checks. The cost of a meaningless boundary in a template compounds silently: it is paid by everyone who has to re-derive the rule by reading imports, forever.

## Proposed fix

Move the seven context-reaching files out of `core/` and into `lib/ui/` (which already holds exactly this kind of component), then enforce with a test that no module under `core/` imports the `$lib` barrel or `$lib/context/*`. See ADR-0005.

Price: about half a day of moving files and fixing imports on `main`. Cascade: one merge at `with/local-signer` where git's rename detection has to carry four modified files across a move, which it does well when the content is otherwise similar, and which is a single supervised operation rather than a recurring tax. `with/hosted-account` inherits it for free (24 merges of its own, three conflict events, all in the lockfile and `package.json`). `website` touches none of these files at all.

Deliberately NOT part of the fix: `$lib/deployments-store`, which five core files import. Turning it into a capability would touch five core files and every consumer, to solve a problem no descendant has ever had (zero modifications to any of them). Name it as a sanctioned dependency in the rule and move on.
