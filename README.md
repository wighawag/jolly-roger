# jolly-roger tooling

Maintenance tooling for the jolly-roger **template tree**, kept on an orphan
branch so it is never inherited by anything built from the template.

## Why an orphan branch

Every file on `main` travels. `create-jolly-roger` copies it into each new
project, and every downstream that tracks the template merges it in via
`offshoot`. A check about the relationship between `main`,
`extended/local-signer` and `extended/hosted-account` is meaningless in a
scaffolded app: those branches do not exist there.

An orphan branch shares no history with `main`, so it can never arrive through a
merge. Nothing here is inherited by anyone, ever.

The cost is discovery: you have to know this branch exists. That is the trade,
and it is the right way round, because the alternative pollutes every downstream
forever to save the maintainer one lookup.

## check-shared-divergence.sh

Fails if a file that two branches SHARE has drifted apart.

```sh
git fetch origin tooling
git show origin/tooling:check-shared-divergence.sh | bash
```

Or from a checkout of this branch, `./check-shared-divergence.sh`.

Run it **after every cascade merge**. It compares COMMITTED refs, not working
trees, so commit the merge first and `--amend` if it fails. That is the moment
the failure it guards actually happens.

Configurable by environment: `BASE`, `VARIANTS`, `WATCH`, `ALLOWED`.

### What it is guarding

The variants are meant to differ from `main` by configuration, and by files
`main` does not have. Not by holding a second version of the same logic. That is
now true by construction: `executor.ts`, `remote.ts`, `types.ts` and
`connection-flow.ts` are byte-identical across all three branches, and `mode.ts`
differs by exactly one line, `TARGET_STEP`, which is the switch the whole
parameterisation exists to provide.

Keeping it that way is the one thing extracting `@etherkit/connection` would
have guaranteed structurally. This script buys the same guarantee without a
package boundary, a release cadence, or a version-skew problem.

### The failure it actually catches

Not a careless edit. A cascade merge whose CONFLICTS were all resolved
correctly, which still leaves the file divergent, because other hunks merged
CLEANLY in the descendant's favour.

This happened twice while the layer was being parameterised:

- `mode.ts`: two prose hunks auto-merged in the variant's favour and survived a
  clean conflict resolution.
- `remote.ts`: the entire payment-rail construction survived as a clean
  auto-merge, because `main`'s version had been derived from the variant's file,
  so the deletion did not read as a change.

Both times `git merge` reported success and the file was still wrong. Conflicts
get attention; clean auto-merges do not.

## What it does NOT catch

It compares files that both branches have. It says nothing about a merge that
breaks a file some other way. The worked example, from the merge that landed the
per-call balance check: both branches had added the same `BalanceStore` import,
neither edit conflicted, and the merge produced a duplicate identifier. Not a
conflict, not a warning, just a file that no longer compiled. `svelte-check`
caught that one and this script would not have.

So the cascade ritual is both, in this order:

```sh
git merge <parent>          # resolve conflicts by intent, not by side
pnpm --filter ./web check   # catches what the merge broke
<this script>               # catches what the merge quietly left divergent
```

## Running it in CI

**Decision: local only.** Kept deliberately out of CI, because the failure it
guards is a human mid-cascade, and that is where it should be caught.

The alternatives, recorded so the reasoning is not re-derived:

- **A workflow on `main`.** GitHub Actions runs workflows from the ref that
  triggered them, so a workflow file on THIS branch will never run on a push to
  `main`. Getting it to run on pushes to `main` means a YAML file on `main`,
  which every downstream then inherits. Rejected: it puts a file about the
  template tree into every project built from the template, which is the exact
  pollution the orphan branch exists to avoid.
- **A separate repository** with a scheduled workflow that clones this one.
  Zero pollution and real automation, at the cost of one more repository. The
  option to revisit if the local habit does not hold.
