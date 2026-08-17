#!/usr/bin/env bash
# Fail if a file that two branches SHARE has drifted apart.
#
# WHY THIS EXISTS, and why it is not in the template.
#
# jolly-roger's variants (with/local-signer, with/hosted-account) are
# meant to differ from main by CONFIGURATION and by files main does not have,
# never by holding a second version of the same logic. That was true by
# accident until the connection layer was parameterised, and it is true by
# construction now: every shared .ts under the watched paths is byte-identical
# across the branches.
#
# Keeping it that way is the whole benefit an extracted package would have
# bought, and this script buys it for less. The failure it guards is one we
# actually hit, twice, rather than a hypothetical: a cascade merge resolves its
# CONFLICTS correctly and still leaves the file divergent, because some hunks
# merged CLEANLY in the descendant's favour. Conflicts get attention. Clean
# auto-merges do not. Both times the merge reported success and the file was
# still wrong, and both times it was only caught by diffing afterwards.
#
# This lives on an orphan branch because it is about the TEMPLATE TREE, not
# about the app the template produces. Anything committed on main is inherited
# by every project scaffolded from it and by every downstream that merges via
# offshoot, where a check for branches they do not have is noise at best.

set -euo pipefail

BASE="${BASE:-main}"
VARIANTS="${VARIANTS:-with/local-signer with/hosted-account}"

# Paths whose shared files must not drift.
WATCH="${WATCH:-web/src/lib/core/connection web/src/lib/core/transaction}"

# Shared files that are ALLOWED to differ, with the reason. Anything not listed
# here must be identical or absent.
#
# mode.ts holds TARGET_STEP, the one line that IS the difference between a
# variant and its parent. It is the switch the parameterisation exists to
# provide, so it is expected to differ and only it.
ALLOWED="${ALLOWED:-web/src/lib/core/connection/mode.ts}"

# .svelte is deliberately NOT watched. Apps are expected to restyle their own
# wallet flows, which is why the extraction seam was drawn at .ts in the first
# place.

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

fail=0
checked=0

for variant in $VARIANTS; do
    if ! git rev-parse --verify --quiet "$variant" >/dev/null; then
        dim "skip $variant (no such branch here)"
        continue
    fi

    echo
    echo "=== $BASE vs $variant ==="

    # Files present in BOTH branches under the watched paths. A file only one
    # branch has is additive, which is the shape divergence is allowed to take.
    shared="$(comm -12 \
        <(git ls-tree -r --name-only "$BASE" -- $WATCH | grep '\.ts$' | sort) \
        <(git ls-tree -r --name-only "$variant" -- $WATCH | grep '\.ts$' | sort))"

    while IFS= read -r f; do
        [ -n "$f" ] || continue
        checked=$((checked + 1))

        if git diff --quiet "$BASE" "$variant" -- "$f"; then
            continue
        fi

        allowed=0
        for a in $ALLOWED; do
            [ "$f" = "$a" ] && allowed=1
        done

        stat="$(git diff --shortstat "$BASE" "$variant" -- "$f" | sed 's/^ *//')"
        if [ "$allowed" = 1 ]; then
            dim "  allowed: $f ($stat)"
        else
            red "  DRIFTED: $f ($stat)"
            # Summary by default: a drifted file can be hundreds of lines, and
            # four of them buries the one line that says what to do about it.
            [ -n "${VERBOSE:-}" ] && git diff "$BASE" "$variant" -- "$f" | sed 's/^/      /'
            fail=1
        fi
    done <<< "$shared"
done

echo
if [ "$fail" = 0 ]; then
    green "OK: $checked shared files checked, none drifted."
else
    red "A file that these branches SHARE now differs between them."
    echo
    echo "That is the thing the connection layer was parameterised to prevent."
    echo "Before 'fixing' it by editing one side, work out which branch the"
    echo "change belongs to:"
    echo
    echo "  - behaviour BOTH want            -> land it on $BASE, cascade down"
    echo "  - behaviour only the variant wants -> it needs a parameter, not a fork"
    echo "  - a merge that quietly kept the old side -> re-resolve against $BASE"
    echo
    echo "The last is the common one, and it does not announce itself: the merge"
    echo "will have reported success."
    echo
    echo "Re-run with VERBOSE=1 to see the diffs."
fi
exit "$fail"
