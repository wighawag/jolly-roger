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
# Idempotent, and safe to run when there is no merge in progress: a path that is
# already absent is left alone and reported as such. It only ever removes paths
# the file names, so it cannot wander.
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

# Comments and blank lines out; everything else is a path.
while IFS= read -r line; do
    path="${line%%#*}"
    # Trim surrounding whitespace without a subshell per line.
    path="$(echo "$path" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -z "$path" ] && continue

    if [ -e "$path" ] || git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
        # `--ignore-unmatch` so a path that is present in the worktree but not in
        # the index (which is exactly the state a conflicted merge leaves) does
        # not abort the run before the rest of the list is handled.
        git rm -q -f --ignore-unmatch "$path"
        rm -f "$path"
        echo -e "${YELLOW}  dropped${NC} $path"
        removed=$((removed + 1))
    else
        absent=$((absent + 1))
    fi
done <"$LIST"

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
