# jolly-roger tooling

Maintenance tooling for the jolly-roger **template tree**, kept on an orphan
branch so it is never inherited by anything built from the template.

## Why an orphan branch

Every file on `main` travels. `create-jolly-roger` copies it into each new project, and every downstream that tracks the template merges it in via `offshoot`. A check about how the feature branches `with/local-signer` and `with/hosted-account` relate to `main` is meaningless in a scaffolded app: those branches do not exist there.

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

Configurable by environment: `BASE`, `FEATURES`, `WATCH`, `ALLOWED`, `EXT`.

**`ALLOWED` IS A TWO-SIDED CONTRACT.** Everything NOT on it must be identical;
everything ON it must DIFFER. An entry that has stopped differing has had its
reason falsified, and that is reported as `ALLOWED BUT IDENTICAL` and fails the
run, because it is how a branch silently stops being a branch: a cascade
resolves the one file that IS the difference in the base's favour, every other
check stays green, and the feature is quietly gone.

Measured in `template-commit-reveal`: reverting `placement/render/index.ts` - the
file that makes `with/pixi-js` a pixi branch rather than its base - passed
`check`, 1,491 unit tests, that repo's own render-host boundary test, its e2e
suite, AND this script. Here the single default entry is `mode.ts`, so the same
mistake turns `with/hosted-account` back into `with/local-signer`.

Two consequences worth knowing before a run surprises you:

- **Give each run the list that belongs to it.** A union list across several
  branches will name entries that are legitimately identical for the base you
  asked about. Judging is done ACROSS the features in one run, so an entry that
  differs for any of them is satisfied - but a run naming one base and another
  base's entries is making a false claim and will say so.
- **An entry shared by NO feature is a note, not a failure.** A branch may
  DELETE an allowed file, which is a difference this script cannot compare and
  is legal by the same rule that makes an added file legal; a path may also
  simply be stale after a rename.

`ALLOWED=` set to empty means **nothing is allowed**, which is the run worth
doing once alongside the real one: it proves the clean files are clean because
they are IDENTICAL rather than because the script matched nothing. (It did not
always mean that - `${ALLOWED:-...}` used to turn an explicitly empty value back
into the default.)

`EXT` is the list of extensions that count as "the same logic", space-separated,
and it defaults to `ts`. That default is this repo's answer and it is a real
choice rather than an oversight: the connection layer's seam was drawn at `.ts`
precisely because apps are expected to restyle their own wallet flows, so
watching `.svelte` here would fail on the divergence the branches exist to have.

It became a variable when a repo further down the tree needed the opposite.
`template-commit-reveal@with/pixi-js` swaps a RENDERER, and the branch is only
affordable because a shared `.svelte` route stays byte-identical across it - so
the interesting shared files there are exactly the ones the default skips. That
was checked by hand the first time, 158 files, which is the kind of thing nobody
does twice.

```sh
BASE=main FEATURES=with/pixi-js EXT="ts svelte" \
  WATCH="web/src web/test" ALLOWED="web/src/lib/placement/render/index.ts" \
  ./check-shared-divergence.sh
```

### What it is guarding

The feature branches are meant to differ from `main` by configuration, and by files `main` does not have. Not by holding a second version of the same logic. That is what keeps them composable: `with/hosted-account` builds on `with/local-signer`, more features are planned, and a project adopts the combination it wants, so a shared file that holds a second version of itself on one branch becomes everyone's problem the moment two features are combined. That is now true by construction: `executor.ts`, `remote.ts`, `types.ts` and `connection-flow.ts` are byte-identical across all three branches, and `mode.ts` differs by exactly one line, `TARGET_STEP`, which is the switch the whole parameterisation exists to provide.

Keeping it that way is the one thing extracting `@etherkit/connection` would
have guaranteed structurally. This script buys the same guarantee without a
package boundary, a release cadence, or a version-skew problem.

### The failure it actually catches

Not a careless edit. A cascade merge whose CONFLICTS were all resolved
correctly, which still leaves the file divergent, because other hunks merged
CLEANLY in the descendant's favour.

This happened twice while the layer was being parameterised:

- `mode.ts`: two prose hunks auto-merged in the feature branch's favour and survived a clean conflict resolution.
- `remote.ts`: the entire payment-rail construction survived as a clean auto-merge, because `main`'s version had been derived from the feature branch's file, so the deletion did not read as a change.

Both times `git merge` reported success and the file was still wrong. Conflicts
get attention; clean auto-merges do not.

## What it does NOT catch

**A DELETION.** It compares files both branches HAVE, so a file removed on one
side and still imported on the other is invisible to it - there is nothing left
to diff. That is not hypothetical: taking pixi off `template-commit-reveal@main`
left its descendant importing a canvas that no longer exists, and the merge
reported success on exactly that hunk while conflicting on three unrelated
files. Same lesson as below, in the one shape this script cannot reach: what
saves you there is the cascade's `verify` step, not this.

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
