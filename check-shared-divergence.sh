#!/usr/bin/env bash
# Fail if a file that two branches SHARE has drifted apart.
#
# WHY THIS EXISTS, and why it is not in the template.
#
# jolly-roger's feature branches (with/local-signer, with/hosted-account) are
# meant to differ from main by CONFIGURATION and by files main does not have,
# never by holding a second version of the same logic. They are composable
# rather than alternatives: with/hosted-account builds on with/local-signer,
# more features are planned, and a project adopts the combination it wants, so
# a second version of the same logic on one of them is a problem for everyone
# who combines it with another. That was true by accident until the connection
# layer was parameterised, and it is true by construction now: every shared .ts
# under the watched paths is byte-identical across the branches.
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
FEATURES="${FEATURES:-with/local-signer with/hosted-account}"

# Paths whose shared files must not drift.
WATCH="${WATCH:-web/src/lib/core/connection web/src/lib/core/transaction}"

# Shared files that are ALLOWED to differ, with the reason. Anything not listed
# here must be identical or absent.
#
# mode.ts holds TARGET_STEP, the one line that IS the difference between a
# feature branch and the stem it builds on. It is the switch the
# parameterisation exists to provide, so it is expected to differ and only it.
#
# ALLOWED IS A TWO-SIDED CONTRACT, and it used to be enforced on one side only.
# Everything not on it must be identical; everything ON it must DIFFER. An entry
# that has stopped differing has had its reason falsified, and the old version of
# this script said nothing at all about that - it only ever subtracted the entry
# from the list of things to complain about.
#
# That is not hypothetical and it is the mirror image of the failure this script
# was written for. Measured in template-commit-reveal, 2026-09-11: reverting
# `placement/render/index.ts` - the one file that makes `with/pixi-js` a pixi
# branch at all - to the base's version passed `check`, passed 1,491 unit tests,
# passed that repo's own render-host boundary test, passed its e2e suite, and
# passed THIS SCRIPT with "none drifted". A cascade resolving that one conflict
# the wrong way would have silently turned the branch back into its base.
#
# Here the stakes are higher, because the single entry is mode.ts: the same
# mistake turns with/hosted-account back into with/local-signer, which is an
# authentication mode, with nothing anywhere reporting it.
#
# `${ALLOWED-...}` AND NOT `${ALLOWED:-...}`, which is a one-character difference
# and the whole reason the documented ritual works. Every README in this tree
# says to run it once with `ALLOWED=` empty, because that is the run which proves
# the clean files are clean because they are IDENTICAL rather than because the
# script matched nothing. With the colon, a set-but-empty ALLOWED falls straight
# back to this default, so that run quietly kept an allowance nobody asked for -
# it just never showed, because the default entry happens not to differ in the
# repos where the ritual is run. Without the colon, an unset ALLOWED still gets
# the default and an explicitly empty one means what it says: nothing is allowed.
ALLOWED="${ALLOWED-web/src/lib/core/connection/mode.ts}"

# Which file extensions count as "the same logic", space-separated.
#
# .ts ALONE IS THE RIGHT DEFAULT HERE and the wrong one elsewhere, which is why
# it is a variable now rather than a hardcoded grep. For this repo's connection
# layer the seam was deliberately drawn at .ts, because apps are expected to
# restyle their own wallet flows, so watching .svelte would fail on divergence
# that is the whole point of the branch.
#
# That reasoning does not transfer. template-commit-reveal's `with/pixi-js`
# swaps a RENDERER, and its affordability rests on a shared .svelte route
# staying byte-identical across the branches - so there the interesting shared
# files are exactly the ones this used to skip. It was checked by hand the first
# time (158 shared .svelte files, none drifted), which is the kind of thing
# nobody does twice. Hence: EXT="ts svelte".
#
# Keep the DEFAULT at ts. A repo that wants more says so.
EXT="${EXT:-ts}"

# `ts svelte` -> `\.(ts|svelte)$`, built once rather than per branch.
#
# The guard is for EXT set to WHITESPACE, which is the only way to reach an
# empty pattern: `${EXT:-ts}` above already turns a genuinely empty EXT back
# into the default, so `EXT=` is safe and falls back to `ts`. Worth having
# anyway, because an empty pattern would match every line and the check would
# silently start comparing lockfiles and PNGs and report drift nobody asked
# about - a checker that quietly widens its own scope is worse than one that
# fails.
if [ -z "${EXT// /}" ]; then
    echo "EXT is empty; set it to one or more extensions, e.g. EXT='ts svelte'" >&2
    exit 2
fi
ext_re="\.($(echo "$EXT" | tr -s ' ' '|' | sed 's/^|//; s/|$//'))\$"

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

fail=0
checked=0

# Which ALLOWED entries were seen SHARED, and which actually DIFFERED, across all
# features. Accumulated over every feature rather than judged per feature: an
# entry may legitimately be the switch for one branch and identical on another,
# and a run naming several features should not fail because of that. An entry
# that never differs ANYWHERE is the one whose reason has gone.
allowed_shared=""
allowed_differed=""

in_list() { case " $2 " in *" $1 "*) return 0;; *) return 1;; esac; }

for feature in $FEATURES; do
    if ! git rev-parse --verify --quiet "$feature" >/dev/null; then
        dim "skip $feature (no such branch here)"
        continue
    fi

    echo
    echo "=== $BASE vs $feature ==="

    # Files present in BOTH branches under the watched paths. A file only one
    # branch has is additive, which is the shape divergence is allowed to take.
    shared="$(comm -12 \
        <(git ls-tree -r --name-only "$BASE" -- $WATCH | grep -E "$ext_re" | sort) \
        <(git ls-tree -r --name-only "$feature" -- $WATCH | grep -E "$ext_re" | sort))"

    while IFS= read -r f; do
        [ -n "$f" ] || continue
        checked=$((checked + 1))

        allowed=0
        for a in $ALLOWED; do
            [ "$f" = "$a" ] && allowed=1
        done
        # Recorded BEFORE the identical-file shortcut below, because "this entry
        # exists on both sides" is exactly what the end-of-run check needs to
        # know and the shortcut is where it used to be thrown away.
        if [ "$allowed" = 1 ] && ! in_list "$f" "$allowed_shared"; then
            allowed_shared="$allowed_shared $f"
        fi

        if git diff --quiet "$BASE" "$feature" -- "$f"; then
            continue
        fi

        if [ "$allowed" = 1 ] && ! in_list "$f" "$allowed_differed"; then
            allowed_differed="$allowed_differed $f"
        fi

        stat="$(git diff --shortstat "$BASE" "$feature" -- "$f" | sed 's/^ *//')"
        if [ "$allowed" = 1 ]; then
            dim "  allowed: $f ($stat)"
        else
            red "  DRIFTED: $f ($stat)"
            # Summary by default: a drifted file can be hundreds of lines, and
            # four of them buries the one line that says what to do about it.
            [ -n "${VERBOSE:-}" ] && git diff "$BASE" "$feature" -- "$f" | sed 's/^/      /'
            fail=1
        fi
    done <<< "$shared"
done

# The other side of the contract: an ALLOWED entry that is shared and IDENTICAL
# everywhere has lost the reason it was listed for.
#
# An entry that is shared NOWHERE is reported but does not fail. Two innocent
# things produce it and neither is drift: a feature branch may DELETE an allowed
# file, which is a difference the script cannot compare and is legal by the same
# rule that makes an added file legal; and a path may simply be stale after a
# rename. Both are worth a line, neither is worth a red build.
for a in $ALLOWED; do
    in_list "$a" "$allowed_differed" && continue
    if in_list "$a" "$allowed_shared"; then
        echo
        red "  ALLOWED BUT IDENTICAL: $a"
        echo "  It is listed as a file that SHOULD differ, and it does not."
        echo "  Either a cascade resolved it in $BASE's favour - which silently"
        echo "  undoes whatever the entry exists to switch - or the entry is spent"
        echo "  and belongs off the list."
        fail=1
    else
        dim "  note: allowed entry not shared by any feature (deleted, or a stale path): $a"
    fi
done

echo
if [ "$fail" = 0 ]; then
    green "OK: $checked shared files checked, none drifted."
else
    red "These branches no longer differ in the way this repo says they should."
    echo
    echo "Two failures are reported above and they are opposite shapes. Read which"
    echo "one you have before reaching for a fix:"
    echo
    echo "DRIFTED - a shared file differs and is not on ALLOWED. That is the thing"
    echo "the connection layer was parameterised to prevent. Work out which branch"
    echo "the change belongs to:"
    echo
    echo "  - behaviour BOTH want            -> land it on $BASE, cascade down"
    echo "  - behaviour only the feature wants -> it needs a parameter, not a fork"
    echo "  - a merge that quietly kept the old side -> re-resolve against $BASE"
    echo
    echo "ALLOWED BUT IDENTICAL - a file listed as the SWITCH has stopped being"
    echo "one. Usually a cascade resolved it in $BASE's favour, which silently"
    echo "undoes what the branch exists to do; occasionally the entry is simply"
    echo "spent and should come off the list. Restore the difference, or remove the"
    echo "entry and say why."
    echo
    echo "Both are the same underlying hazard and neither announces itself: the"
    echo "merge will have reported success."
    echo
    echo "Re-run with VERBOSE=1 to see the diffs."
fi
exit "$fail"
