---
title: "Splitting the context costs each descendant one both-added merge, and then nothing"
type: finding
status: spotted
created: 2026-08-22
source: did it for template-commit-reveal, twice (once against a monolith, once against the split), and measured what bleeps and mandalas now face
follows: the-merge-tax-is-in-the-composition-root-not-in-core
---

# The one-time price, and the recipe

`createContext` is now three files at every node from `jolly-roger@main` down: `core.ts` (the template's half), the app's half, and a short `index.ts` composing them. `template-commit-reveal` is aligned. `bleeps` and `mandalas` are not, and this is what they face.

## Why there is a price at all

Both files are called `core.ts` and neither was copied from the other, so git sees **both-added with no shared history for that path** and cannot merge them as a file. `template-commit-reveal`'s alignment took eight hunks for that reason. It is genuinely one-time: afterwards the two paths share an ancestor and every later merge is an ordinary file merge.

Set against what the split replaced, that is cheap. The catch-up BEFORE upstream split cost 237 hand-ported lines, because git compared an 800-line monolith against a 27-line `index.ts`, reported ONE conflict, and never mentioned the file the changes actually belonged in. A conflict count that low on a change that large is the worst possible signal.

## What bleeps and mandalas face today

| repo | conflicted files |
|---|---|
| `bleeps` | 6: `README.md`, `context/index.ts`, `ui/navbar/navbar.svelte`, `routes/+page.svelte`, `routes/demo/lib/setGreeting.ts`, `web-config.json` |
| `mandalas` | 12: the above plus `context/types.ts`, `app.css`, `+layout.svelte`, `.env.localhost`, `playwright.config.ts`, `e2e/fixtures/test.ts`, `scripts/run-e2e-tests.sh` |

Only `context/index.ts` is about the split. The rest is eight commits of ordinary drift, and both were already behind before any of this.

## The recipe, from doing it

1. **Take upstream's `index.ts` wholesale.** It is 28 lines and contains no local content: it imports the two halves and composes them. Its only local edit is naming the app factory.
2. **Build `core.ts` by 3-way merge, not by hand.** `git merge-file --diff3 -p <yours> <the monolith you both came from> <upstream's core.ts>`. The base is the descendant's merge-base `context/index.ts`, which is what both sides actually diverged from. This is what turns a rewrite into a handful of hunks.
3. **Put the app's own members in the app half.** `mandalas` has `purchaseFlow` and a batch size; `bleeps` has its own. They go in that repo's app file and arrive in the context through `...appContext`, so **the literal in `core.ts` never has to be edited**, which is where several of the recorded conflicts used to land.
4. **Keep your own `CoreServices` payload.** It is legitimately wider than upstream's when the app needs more (`template-commit-reveal` needs the executors, delegation, balances and clock that a greeting demo does not). Match the MECHANISM (`createApp`, `AppContext`, `AppFactory`, the optional `start`) and let the payload differ. The mechanism is what has to merge; the payload is the local contract.
5. **Let `check` find the duplicates.** Three slipped past the merge at `template-commit-reveal` and every one was a type error: an `app.ts` that arrived from upstream into a repo whose app half is `game.ts`, a `balanceCheck` and `confirmation` built twice, and `delegation` listed twice in the literal. None would have been caught by reading, and all three were caught before running anything.

## What the split does NOT fix, restated because it will be assumed

The six recorded `main` to `with/local-signer` conflicts are in the connection/executor block, which is core on BOTH sides. Replaying them names `buildSignerClient`, `signerExecutor`, `accountExecutor`, `accountBalance`, `delegation`, `accountData`. A variant extending core is a different problem from an app composing on top of it, and this split addresses only the second. The first wants the variant's signer layer in a file of its own with a spread, which is the shape the merge-tax note reached for and nobody has built.

## One thing worth changing upstream

`CoreServices` at `jolly-roger@main` lists what the greeting demo happens to use. `template-commit-reveal` had to widen it to nine more members, and `mandalas` will widen it too. That guarantees the type block conflicts on every alignment. It would be better as what core HAS rather than what this demo needs: then a descendant picks from it and never edits it. Cheap to do, and it removes the one hunk that is otherwise permanent.
