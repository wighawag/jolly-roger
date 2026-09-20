# `integration`: the node a descendant repo points at

> **This file describes a BRANCH of the jolly-roger template tree.** If you are reading it in a repo built from the template - a game, or another template further down - it is describing where your code came from, not where it is. Nothing in it is a statement about the repo you are in.

**Membership is `with/local-signer` and `with/embedded-chain`, and `with/hosted-account` is deliberately OUT.** That is the one line the name does not carry, and it is here because the absence of such a line is exactly what made `with/all` mislead one level down.

## What it is for

`stem: [with/local-signer, with/embedded-chain]`. It holds no code of its own: every line on it comes from one parent or the other, and the one file it had to compose is `context/core.ts`.

It exists because the tool forces it. `offshoot-fanout`'s cross-repo edge is `stemBranch`, which is a single string and cannot be combined with `stem`, so a DESCENDANT REPO cannot integrate two parent branches itself - it can name exactly one. A repo that wants both capabilities therefore needs a branch here that already has both, and pointing its `stemBranch` at this one is the whole mechanism. `template-commit-reveal@main` is the first such repo.

## Why `with/hosted-account` is out, which is a judgement and reversible

It needs a hosted wallet service to be exercised at all, and everything that brings that service is inherited by every repo below: a `@etherplay/dev-wallet-host` devDependency, a `wallet-host` script, 28 lines of playwright config, 101 lines of e2e runner and a 293-line e2e suite. A game that does not want hosted sign-in deletes all of it, and pays a `modify/delete` conflict on each file for as long as it lives.

**The asymmetry is the argument, not the size.** Adding a stem to an integration node later is cheap - one array entry, one merge - and removing one is not, because by then every descendant has merged the thing being removed and each has to unpick it. So the default is to include a capability the day a game asks for it, rather than to include it in case one does.

## What each parent contributes

| parent | what it adds | the switch |
| --- | --- | --- |
| `with/local-signer` | sign-in derives a key this browser holds, so a move costs no wallet prompt | `TARGET_STEP` in `core/connection/mode.ts` |
| `with/embedded-chain` | a world whose chain is an EVM in the tab, with the app's own deploy scripts run onto it | `lib/embedded/`, additive; see `README.embedded-chain.md` |

**They compose rather than overlap, and the one place they meet is worth knowing before you read a merge here.** `context/core.ts` is the only file both parents edit, so it is the only conflict this node has ever had. Both sides were additive in four of the five hunks - the local signer's `signer` / `chainInfo` / `rawPayment` / `hasLocalSigner` beside the embedded world's `walletPrompts`, as a return member, a destructure, a parameter and a call argument.

The fifth is a comment on the same `{prompts: ...}` argument, and neither side survived the other unedited. `with/local-signer` says this client prompts "which is the default and therefore unwritten"; on this node it is not a default, it is `walletPrompts`, and the world supplies it. So both facts are now stated as a pair: **the local signer's silence is a property of the KEY, and this client's is a property of the WORLD.** Collapsing them into one flag is the mistake the pair exists to prevent, and a future merge that simplifies it has reintroduced it.

## What this node does NOT reconcile, and it is the first thing a descendant will meet

A world takes the app's `targetStep` rather than choosing one (`request.targetStep` in `lib/embedded/world.ts`), which is deliberate: a world chooses the CHAIN, never how the app authenticates. On this node that means the embedded world runs with `TARGET_STEP = 'SignedIn'`, which is a combination neither parent could have: on `with/embedded-chain` alone the target is `WalletConnected`, so no sign-in happens and no local signer is derived.

Nothing here asserts that combination works in a browser. `/offline-demo` is `with/embedded-chain`'s route and its measurements were taken there, at `WalletConnected`. The suites pass on this node, and `check` plus `test:unit` prove the text compiles and the units hold, which is not the same as a round played in a tab.

## The divergence ritual

On `tooling`, in `divergence-ritual.md`, which has a block for this branch: the two `ALLOWED` lists, the three-way runs against each parent and against `main`, and the counts each last produced. The three-way form is the one that matters here and it is the same shape `template-commit-reveal@with/all` uses, because it is the claim this branch makes: against `with/local-signer` it differs in exactly what the embedded axis contributes, against `with/embedded-chain` in exactly what the signer axis contributes, and against `main` in exactly the union.

Measured on creation, 2026-09-20: 2, 1 and 3 files at the default width with `ALLOWED=` empty, and 6 of 101 over `core/`. At the wide width the union is 43, which is `with/local-signer`'s 37 plus `with/embedded-chain`'s 7 less the one file both edit.

**Holding no code of its own is the acceptance criterion rather than a description**, and it is checkable in one command, which is why it is written as three runs rather than as a sentence.
