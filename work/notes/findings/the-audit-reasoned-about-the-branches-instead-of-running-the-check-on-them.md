---
title: The audit that built the guard reasoned about the intra-repo branches instead of running it on them, and one of them had dropped four paths since August
type: finding
status: FIXED 2026-09-25 (entry in with/local-signer, cascaded to with/hosted-account and integration)
spotted: 2026-09-25
relates-to: work/notes/findings/every-omissions-list-in-the-tree-was-incomplete.md, scripts/check-omissions.mjs, .offshoot-omissions
---

# The guard's own rollout made the mistake the guard exists to prevent

The 2026-09-25 audit measured every REPO in the tree against its stem repo, found all five lists incomplete, wrote `scripts/check-omissions.mjs` and filled the lists in. It then said this about the branches inside those repos: "plus the intra-repo branches which correctly drop nothing of their own."

That sentence was not measured. It was reasoned, from the true premise that a sibling branch inherits its parent's deletions and therefore has nothing of its own to declare. It is false for `with/local-signer`, and it was false five weeks before it was written.

Running the guard on the cascade that DELIVERED it to that branch, 2026-09-25:

```
✗ 4 path(s) are absent here, were inherited, and are not in .offshoot-omissions:
    contracts/deployments/sepolia/.chain
    contracts/deployments/sepolia/GreetingsRegistry.json
    contracts/deployments/sepolia/GreetingsRegistry_Implementation.json
    contracts/deployments/sepolia/GreetingsRegistry_Proxy.json
```

`main` has a Sepolia deployment and that branch deleted it on 2026-08-17 (`b947f89`), because the records describe MAIN's contracts and this branch's `GreetingsRegistry` has a different ABI. The deletion is right. What was missing is any way to find out.

## The reason was written down, carefully, in the one place nothing could find it

`b947f89`'s message is four paragraphs long. It explains the ABI mismatch, names the symptom (`pnpm attach sepolia` exporting another contract set's ABI, surfacing as a type error several files away in `routes/demo/lib/setGreeting.ts`), records a known gap in `@rocketh/export`, says where a future deployment belongs (`sepolia-signer`, on the branch that owns it), and ends:

> Expect a modify/delete conflict here whenever main redeploys sepolia. Resolve it by keeping the deletion.

That is precisely the sentence somebody needs mid-merge, written by somebody who knew they would need it, addressed to a reader who has no way to reach it. **A commit message is a letter to whoever runs `git log` on the right path, and nobody mid-cascade knows which path that is.** This is the same shape as the excavation that motivated the list in the first place, only worse: there, the intent was in no diff at all and had to be recovered from a merge resolution; here, the intent was written in full prose and still could not be found. The list is not a substitute for the message. It is the index.

## Why the branches were the part that got reasoned about

Three things made it easy, and all three generalise:

- **The premise is true almost everywhere.** `with/embedded-chain`, `with/hosted-account`, `website`, and all four template-commit-reveal branches measure zero, honestly. Four out of five is exactly the hit rate that stops people checking the fifth.
- **The check is cheapest at cascade time and the audit was not a cascade.** `MERGE_HEAD` IS the stem commit during a merge, which is the whole reason the script defaults to it; an audit has to name a ref by hand, per branch, and a branch pair is one more thing to enumerate than a repo pair.
- **The zero it returns looks the same either way.** `✓ covers all 0 path(s)` is both the honest sibling-branch answer and the answer a wrong ref gives, which is why the script prints the COUNT. Nobody ran it, so nobody saw a count at all.

**A guard is not installed until it has been RUN at every node it claims to cover.** The audit's own table has a column for "drops" with a measured number in every row; the branches got a sentence instead of a row. The difference between those two things is the entire subject of the finding that table appears in.

## What was done

`contracts/deployments/sepolia` is a directory entry in `with/local-signer`'s list now, with the reason, the symptom and the citation to `b947f89`. `with/hosted-account` and `integration` inherit both the deletion and the line through their merges, and the entry reads true in all three.

The list file now says which of its entries are the REPO's and which are the BRANCH's, because **a branch's stem is not its repo's stem.** `with/local-signer`'s three inherited entries are what jolly-roger drops from `template-svelte-shadcn`; the fourth is what the branch drops from `main`. Nothing in the machinery distinguished those before, and the file reads as one list unless it says so.

The entry earned itself one merge later: `integration` merges `with/embedded-chain`, which still HAS the Sepolia deployment, so that is the merge where those four paths are genuinely present-in-the-stem-and-absent-here. Before today that merge would have failed the check.

## The correction to make to the other finding

Its closing section says the tree's intra-repo branches "correctly drop nothing of their own". Read it as: measured zero at `with/embedded-chain`, `with/hosted-account`, `website` and all four `template-commit-reveal` branches, and FOUR unlisted paths at `with/local-signer`, which nobody had run it against.
