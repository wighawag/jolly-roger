#!/bin/bash
#
# Re-drop every path listed in .offshoot-omissions.
#
# THE ONE COMMAND for the conflict a deletion causes. When the template touches
# a file this repo has deleted, the cascade stops with "deleted by us, modified
# by them" and the resolution is always the same: it stays deleted. Run this,
# then commit the merge.
#
#   bash scripts/apply-omissions.sh && git commit
#
# ONE COPY OF THIS SCRIPT IN THE TREE, WITH ONE DELIBERATE EXCEPTION. It lives at
# `template-svelte`, the root, and cascades unchanged to every descendant. The
# exception is `template-commit-reveal` and its descendant `reveal-or-die`, which
# also carry `scripts/check-dangling-imports.mjs` and run it from here, gating
# the "now commit the merge" line behind it. That version is NOT drift: two
# cascades out of that template broke `reveal-or-die` through hunks that merged
# CLEANLY, so nothing reported a conflict at all, and this is the moment that
# check is worth a second. Those two repos are therefore expected to conflict
# with this file on every cascade that touches it, for ever. RESOLVE IT BY
# KEEPING BOTH HALVES - whatever changed up here, plus their dangling-import
# block - and never by flattening either side.
#
# Idempotent, and safe to run when there is no merge in progress: a path that is
# already absent is left alone and reported as such. It only ever removes paths
# the file names, and that is now ENFORCED rather than asserted - see the
# validation below, which exists because this script runs `git rm -r` and
# `rm -rf` on whatever the list says.
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LIST="$REPO_DIR/.offshoot-omissions"

if [ ! -f "$LIST" ]; then
    echo -e "${RED}✗ No .offshoot-omissions at ${LIST}${NC}"
    exit 1
fi

cd "$REPO_DIR"

removed=0
absent=0

# THE WHOLE LIST IS READ AND CHECKED BEFORE ANYTHING IS REMOVED, so a bad entry
# stops the run with nothing done instead of half-applied. Half-applied is the
# worse failure here by a distance: it happens inside a conflicted merge, and it
# leaves a working tree that matches neither side of it.
paths=()
while IFS= read -r line; do
    path="${line%%#*}"
    # Trim surrounding whitespace without a subshell per line.
    path="$(echo "$path" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -z "$path" ] && continue

    # AN ENTRY IS A LITERAL PATH INSIDE THIS REPO, AND THAT IS CHECKED RATHER
    # THAN TRUSTED, because what follows is `git rm -r` and `rm -rf` on a string
    # read out of a text file. `*` is the one that matters: to `git rm` it is a
    # PATHSPEC, so a single-character typo in this file would mean "remove every
    # tracked path", recursively, inside a merge. None of the shapes below can be
    # a real entry, so each one stops the run rather than being skipped quietly -
    # a list this script cannot read is not a list to apply most of.
    case "$path" in
    /* | -* | :*) refuse="an entry is a path relative to the repo root" ;;
    . | .. | ../* | */.. | */../*) refuse="an entry cannot point outside the repo" ;;
    *'*'* | *'?'* | *'['*) refuse="an entry is a literal path, never a pattern" ;;
    *) refuse="" ;;
    esac
    if [ -n "$refuse" ]; then
        echo -e "${RED}✗ ${LIST} names \`${path}\`, and ${refuse}.${NC}"
        echo -e "${RED}  Nothing has been removed. Fix the entry and run this again.${NC}"
        exit 1
    fi

    paths+=("$path")
done <"$LIST"

for path in "${paths[@]}"; do
    if [ -e "$path" ] || git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
        # `-r` BECAUSE AN ENTRY MAY NAME A DIRECTORY, which is the form this list
        # recommends for a whole replaced tree and which two repos in the tree
        # already use. Without it `git rm` refuses with "not removing <dir>
        # recursively without -r", `set -e` aborts the run on the spot, every
        # later entry is left in place and the stem check below never runs at
        # all - inside a merge, reading as though git itself had failed. Harmless
        # for a file, so it is unconditional rather than a special case.
        #
        # `--ignore-unmatch` so a path that is present in the worktree but not in
        # the index (which is exactly the state a conflicted merge leaves) does
        # not abort the run before the rest of the list is handled. `--` so an
        # entry can never be read as an option.
        git rm -q -f -r --ignore-unmatch -- "$path"
        # `-r` here too: `rm -f` cannot remove a directory, so an untracked one
        # (a merge can leave that) survived the line above and was reported as
        # dropped anyway.
        rm -rf "$path"
        echo -e "${YELLOW}  dropped${NC} $path"
        removed=$((removed + 1))
    else
        absent=$((absent + 1))
    fi
done

if [ "$removed" -eq 0 ]; then
    echo -e "${GREEN}✓ Nothing to drop: all ${absent} omitted path(s) are already absent.${NC}"
else
    echo -e "${GREEN}✓ Dropped ${removed} path(s); ${absent} were already absent.${NC}"
fi

# AND THE OTHER DIRECTION, which is the one this script cannot do by itself.
#
# Everything above trusts the list. `check-omissions.mjs` asks whether the list is
# still TRUE - whether this repo drops anything nobody wrote down - and it needs
# the stem to answer, because "deliberately absent" and "never existed here" are
# indistinguishable from inside one repo. A merge in progress is exactly when the
# stem is available for free: MERGE_HEAD *is* the stem commit.
#
# HERE RATHER THAN IN `verify`, for the same reason the dangling-import check is
# here: this is the moment the mistake is made. It is also the only moment the
# comparison is free, so a run outside a merge simply says so and is skipped
# rather than failing the script.
#
# `git rev-parse -q --verify MERGE_HEAD`, never `test -f .git/MERGE_HEAD`: in a
# WORKTREE `.git` is a FILE, so that test is silently false and every `&&` after
# it quietly does nothing.
if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    echo
    if ! node "$REPO_DIR/scripts/check-omissions.mjs"; then
        echo -e "${RED}  Resolve that before committing the merge: either list the"
        echo -e "  path with its reason, or keep the file.${NC}"
        exit 1
    fi
else
    echo
    echo -e "${YELLOW}  Not in a merge, so the list was not checked AGAINST THE STEM.${NC}"
    echo -e "${YELLOW}  That check is what catches a path nobody listed:${NC}"
    echo -e "${YELLOW}    git fetch stem <branch> && node scripts/check-omissions.mjs FETCH_HEAD${NC}"
fi

if [ "$removed" -gt 0 ]; then
    echo -e "${GREEN}  Now commit the merge.${NC}"
fi
