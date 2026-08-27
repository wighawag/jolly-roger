---
title: The navbar is the next composition root, and the guarantee it carries is tested in zero descendants
type: finding
status: spotted
created: 2026-08-26
source: resolving the eight-commit cascade into bleeps and mandalas by hand, then running both e2e suites against a real chain
follows: the-merge-tax-is-in-the-composition-root-not-in-core
---

# What the height-shell cascade cost, measured on the two repos that took it

The merge-tax finding counted conflicts on jolly-roger's own branches and named `web/src/lib/context/index.ts` as the most-conflicted file in the tree. This is the same exercise done on two descendant *repos*, `bleeps` and `mandalas`, taking the same eight commits. The headline is that `context/index.ts` did not conflict in either, and something else did, twice.

Both repos ended green: check clean, 890 and 747 unit tests, 30/30 and 15/15 e2e.

## What worked, and is the model for everything below

**`ui/chrome.ts` did its job on its first real test.** Moving the *list* of bars out of `routes/+layout.svelte` meant mandalas' custom RPC gate landed in a file the template touches rarely. That gate is not the template's: it hides the bar on `/mandala` and `/about` and shows it on `/`, where upstream hides it on `/` alone. Before the list, that condition was a `$derived` in the most-edited file in the repo. After it, it is a `when` in a file whose whole purpose is to differ.

**CSS variables did the same.** Mandalas' chrome is a `<header>` bracketing the nav with a multicolor rule above and below, so what the shell must reserve is `--header-height` (3.5rem), not the nav row (3rem). Repointing `--navbar-height` at it was a one-line change in `app.css` and `core/` never noticed.

Both are the same move: the template states a contract, the descendant fills it in a file of its own. Everything proposed below is more of this.

## 1. The navbar is where the merge tax went

Both repos have wholly rewritten navbars: bleeps a measured tab row, mandalas a bracketed header with a fold-to-`More` link row. Upstream keeps adding features to the same file, and each addition is now a hand-port into two divergent implementations. `navbar.svelte` conflicted in both, three separate hunks in mandalas, and no automatic resolution was possible for any of them: mandalas' was resolved by taking its own file wholesale and then porting the one upstream behaviour it could not go without, by hand.

That is exactly the shape the merge-tax finding described for `createContext`: one file that both a template change and a variant change must always edit. The difference is that `context/index.ts` has an agreed fix waiting (split it into named builders) and the navbar has none.

## 2. The pulse is a written promise that nothing enforces

`ui/in-flight/sending.ts` states a guarantee in prose:

> This is the rung that is up whenever the guard is armed, which is why the navbar renders it OUTSIDE the connected/disconnected branch: a connection that downgrades mid-dispatch [...] must not take the only mark on screen with it.

The promise is made in `sending.ts`. It is kept in `navbar.svelte`. Every descendant rewrites `navbar.svelte`.

A descendant that does so and does not know about that paragraph loses the guarantee silently, and the symptom is the exact bug the feature was built to fix: a local-signer send raises the browser's "leave site?" dialog with nothing on screen explaining it. Mandalas would have shipped precisely that. It was caught by reading the module doc while resolving an unrelated conflict, which is not a control.

**And the only test of it is unreachable from any descendant that needs it.** `data-testid="sending-transaction"` is asserted in exactly one place, `e2e/tests/sending-indicator.e2e.ts`, which drives `/demo/` and `Enter your greeting...`. Any app that replaces the demo route deletes that suite. Both of these did, for that stated reason. So the mechanism with the most carefully written promise in the in-flight code is verified in **zero** of the repos most likely to break it.

The coupling is incidental rather than essential: the navbar-mark assertion does not need the greeting form, it needs any dispatch at all.

## 3. Inherited tests restate the contract instead of reading it

Three separate failures in mandalas, one cause. `layout-shell.e2e.ts` arrives from the template carrying template facts as literals:

| literal | what broke |
|---|---|
| `rect('nav')` | mandalas' chrome is the `<header>`; `nav.bottom` is 4px short, so `content.top === nav.bottom` failed by exactly the bottom rule |
| `toBe(48)` | that is `--navbar-height` in the template; here the chrome is 56 |
| `['/', '/demo/', '/transactions/', '/explorer/']` | no `/demo/` route, and pointing a smoke test at a missing route does not fail, it asserts against the 404 page and passes |

`AppShell` already demonstrates the fix for the first: `data-app-content` exists precisely as "a stable name for a descendant that has to reach the region from outside the tree". It exposes no such handle for the chrome, so the test guessed at the DOM instead, and guessed the template's shape.

The third one is the nastiest, because its failure mode is a pass. Bleeps had already been bitten by it once and recorded it (`4d09f4a1`: "ONE TEST WAS PASSING ON A 404"), and the same trap arrived again in a new suite.

## What it costs and who pays

Whoever cascades next, and it compounds with each descendant. Three repos carry a full copy of `core/` today. Every future navbar feature is N hand-ports; every future inherited e2e assertion carrying a template literal is N edits, each of which fails loudly at best and passes falsely at worst.

The e2e run is what caught all of it. Between them these two repos have 1,637 unit tests and both typechecked clean at every intermediate step, including at a point where a CSS comment closed twice meant `--navbar-height` never parsed and the shell reserved nothing at all. That is the merge-tax finding's rule restated with new evidence: a clean merge is evidence about text, not behaviour, and `check` is evidence about types, not layout.

One further trap, recorded because it nearly landed: in bleeps the auto-merge **silently dropped two definitions** (`showRpcBanner`, and the `repoURL`/`communityURL` import) while leaving both usages inside conflict markers. Resolving by picking either side would have compiled to an undefined variable. Read the whole file, never the hunks.

## Proposed fixes, in cost order

**1. Give `AppShell` handles for the chrome (minutes, cascade: near zero).** `data-app-navbar` on the navbar slot and `data-app-bars` on the sticky group, beside the existing `data-app-content`. Then rewrite `layout-shell.e2e.ts` to measure those, read `--navbar-height` from computed style rather than asserting `48`, and take its route list from an exported constant a descendant overrides. Removes a whole class of inherited-test breakage at every descendant at once.

**2. Split the navbar-mark assertion out of `sending-indicator.e2e.ts` (under an hour).** The badge-and-pulse assertions become a suite that needs a dispatch and no particular route, so it survives in an app that has no `/demo/`. Item 3 is what makes it worth doing; without it the guarantee in `sending.ts` is enforced nowhere it matters.

**3. Extract the account-cluster marks into a component (half a day).** The pending badge and the sending pulse become one small component that the template navbar and any custom navbar both drop in, so a descendant that rewrites its bar keeps the guarantee and gets future marks for free. This is the chrome-list move applied to the navbar, and it is what stops item 1 of the cost section growing with every feature.

**4. Do NOT abstract the demo route.** The merge-tax finding reached this for `setGreeting.ts` and it holds for the suites that drive it: the divergence is genuine, and the only fix is an abstraction that makes both sides worse. Deleting the demo-coupled suites per descendant is cheap, correct, and already done in both. The thing to fix is suites that are *incidentally* coupled to `/demo/` (item 2), not the ones that genuinely test it.
