---
status: accepted
created: 2026-09-25
---

# The chrome is a per-surface choice, because a chrome that outlives its surface makes claims about a world it cannot see

`routes/+layout.svelte` renders the chrome once, outside every route subtree: one navbar and the bars from `ui/chrome.ts`, for every route there is. A **surface** - whatever owns the screen right now - may now declare a chrome of its own on its page data (`surfaceChrome`, typed in `app.d.ts`), and `chromeFor` in `ui/chrome.ts` is the whole of the decision: the declaration if there is one, `APP_CHROME` otherwise. `SurfaceNavbar.svelte` renders whichever navbar that produced. **A surface that declares nothing gets exactly the chrome it has today**, which is every route in this app and every route in every descendant until one says otherwise.

**The framework offers the CHOICE and does not take the position.** That distinction is the decision, not a hedge in front of it: nothing here says an offline world, an embedded world or any other surface should decline the app's chrome, because whether the app's chrome is still telling the truth is a fact about a particular page in a particular game, and a template that answered it on a game's behalf would be answering it for repos it has never seen.

## The test that decides, which is not the one everybody reaches for first

The tempting line is "embedded versus full screen", and it is wrong in both directions. The line that holds is **whether the chrome's claims remain true of the surface the player is looking at.**

- A player connected with their own account, looking at a page that embeds something else as ONE THING among others - a demo panel, a preview, a world in a frame - is looking at a page where the chrome's claims are all still true. It describes the app around the embedded thing, and that app is really there. It keeps the app's chrome and declares nothing, and this is not a compromise: replacing the chrome there would delete a true account, a true balance and a true connection state from a page that has them.
- A world that OWNS the page makes the same claims false. The chrome then appears to describe the world: the account shown is one the world generated, the connection is to something that is not a network, and a credits figure is a number about money the world invented. A player who played the online version first comes back, sees a different address with a different balance in the same position on screen, and the honest reading is "my account changed". Nothing on the page contradicts them.

So it is about the page's OWNERSHIP, not its size. A full-screen embed of the app's own game keeps the chrome; a small panel that is really a different world does not.

## What a surface that declines must then do, which follows from the same test

**A control whose only truthful value here is "not applicable" is ABSENT.** Not greyed out, not showing a placeholder, not a dash. "Connected" offline is not true-but-boring, it is meaningless - there is nothing to connect to and nothing a player could do about it either way - and a control reporting a state with one possible value is the same defect as a dialog with one possible answer, which this tree has removed twice already (the lobby's authorise step, the acquisition rail's three transactions).

That is the rule the mechanism serves, and it is the reason a surface supplies a chrome rather than a flag that dims the app's.

## The layering fact that shaped the mechanism

The chrome is rendered by the LAYOUT. A page that provides its own context does so INSIDE its route subtree, deliberately shadowing the app's context for that subtree only, so **a chrome rendered from the layout cannot see the world it would describe.** There are exactly two ways out of that, and the one taken here is the small one.

A declared navbar takes its facts from **app-scoped modules** - the same modules the page itself asked to start the world - rather than from a context below it. That is not a workaround: a world you can only describe from inside it is a world whose lifecycle is owned by a component, and the surfaces that need this already keep theirs in a module, because a world has to outlive a mount to be resumable at all. The alternative, hoisting a world context into `lib/core`, is rejected below.

## Considered options

- **Teach the app's chrome which world it is in: parameterise the navbar, the account and the RPC banner.** Rejected, and it is the option that was assumed correct for a month (see ADR-0004 on `template-commit-reveal`'s `work` branch, which this decision amends). It treats the problem as incompleteness, and it is not: the app's chrome answers an online player's questions, and two of its answers have no truthful form in a world that generated its own wallet. Pointing it at another chain gives the player a correct address for an account that is still not theirs. It is also the most expensive shape available, because every parameter added to satisfy one descendant lands in `lib/core` for all of them.

- **Add a no-navbar mode to `AppShell`, so a surface can decline the chrome outright.** Rejected, because nothing needs it and it is not free. `AppShell` already takes `navbar`, `chrome`, `routeId` and `children`, so "decline the app's chrome" is expressible as "supply your own" with no change to a `lib/core` API, and the surfaces that want to decline want SOMETHING at the top anyway - which world this is, and the way out. A genuinely empty slot is a different change with a geometry contract behind it: the shell reserves `var(--navbar-height)` unconditionally, so a mode that renders nothing has to stop reserving it, and `layout-shell.e2e.ts` measures exactly that reservation. If a surface ever proves it needs one, it is its own argued change here, not a flag smuggled in beside this one.

- **Hoist the world context into `lib/core`, so the layout's chrome can see it.** Rejected, and it is the option that would make the problem disappear rather than be solved. It puts "there may be a second world" into the framework every descendant inherits, so every `lib/core` consumer acquires a question it does not have, and the nesting that makes a second world safe today (svelte's `setContext`, shadowing one subtree, which is one element in a route) becomes a lifecycle the framework owns. The measured evidence against it is that the surfaces wanting this ALREADY keep the world in an app-scoped module, because a world must survive a remount; so the facts a chrome needs are reachable without hoisting anything, and hoisting would buy a framework concept to reach data that is already global.

- **A per-route `if` in `routes/+layout.svelte`.** Rejected on the cost this tree already knows how to measure. That file is the most-edited in the template and byte-identical across eleven nodes of it; a condition naming a route puts a per-repo answer in the one file every repo re-merges, and a descendant that deletes the route keeps the condition. The same argument retires the near-miss variant, a route-id table in `ui/chrome.ts`: it is out of the hot file but it still names a page from a distance, so deleting the page leaves an entry pointing at nothing.

- **A declaration the route sets at MOUNT, into a store the layout reads.** Rejected: it makes the chrome depend on something having mounted, so the first paint and the prerendered HTML show the app's chrome and then swap, which is the "my account changed" flicker in miniature, on every load. Page data is static, prerenders, and is resolved before the page renders.

- **Let a surface supply its own `AppShell` instead.** Rejected as too big a hammer for this, though it remains available and `core/ui/chrome.ts` already says so. The shell owns the HEIGHT contract, which is not a surface's business and is the one thing in this area that must not vary; what varies is what goes in the slots, and that is what this mechanism varies.

- **Put `SurfaceChrome` and `chromeFor` in `core/ui/chrome.ts` beside `ChromeBar`.** Rejected for the reason ADR-0007 already gives about the list itself: `core/` holds the SHAPE of a bar and the height contract, and the app holds which chrome its surfaces get. Keeping the decision in `ui/chrome.ts` also means this change adds nothing to a `lib/core` API, so a descendant that has diverged `core/` inherits it without a conflict there.

## Consequences

- **The default is untouched, and that is the clause protecting the repos that adopt nothing.** `chromeFor({})` returns `APP_CHROME`, whose navbar is absent (meaning the app's) and whose bars are `CHROME`. Every existing route in this app and in every descendant renders exactly what it did. Measured at jolly-roger `main`: check 0/0, 941 server units in 80 files and 42 client units in 8 files (+3 and +3, both this mechanism's own), and 58 of 58 e2e including the shell's geometry suite.

- **The mechanism is pinned in both directions, at the level it lives.** `test/lib/ui/surface-chrome.test.ts` holds the decision and `test/lib/ui/surface-navbar.svelte.test.ts` holds the rendering. Four deliberate mutations were run: the selection always answering the app's chrome fails two of the three decision tests; the selection never falling back fails exactly one; the renderer always rendering the app's fails one; and the renderer rendering BOTH fails two, including the `data-app-navbar` count. The second mutation is the one worth recording, because it would strip the navbar off every route in this tree and **nothing else in 941 tests notices it** - that single test is the whole guard.

- **A declared navbar must carry `data-app-navbar` on its root.** A replacement navbar is still a navbar: the shell reserves space for whatever is in that slot, and `e2e/tests/layout-shell.e2e.ts` measures that attribute to hold that the page sits BELOW the chrome rather than under it. This tree shipped the other outcome once, and the casualty was a game's phase countdown (ADR-0007). The count is asserted as part of the mechanism's own test, so a swap that produced two navbars or none fails before it reaches a browser.

- **A declared navbar is zero-prop and self-gating, exactly like a bar.** It is rendered outside every route subtree, so it reads app-scoped modules and renders nothing while there is nothing yet to say. The consequence worth stating plainly: **it must not call `getAppContext()`**, because up there that returns the APP's context, which is the very thing whose claims it exists to stop repeating.

- **A surface may declare bars WITHOUT declaring a navbar**, which falls out for free and is the right shape for a page that needs to say one more thing while still showing this app.

- **The declaration is per-repo BY NATURE, and it is placed where that is safe.** A required parameter whose value differs per repo must not have its answer written at a call site the template also writes: that is the trap recorded in `template-commit-reveal`'s `work` branch, where a safety flag arrived in a descendant carrying the template's answer through a clean merge, with check, 1821 unit tests, 51 e2e and the import check all green. This mechanism is not that trap and the difference is structural rather than a matter of care. The template writes `chromeFor(page.data)`, which contains no answer; the ANSWER is a `+page.ts` in the surface's own directory, so a repo that inherits the surface inherits an answer about that surface, and a repo that deletes the surface deletes the answer with it. There is no third place where a stale answer can sit.

- **`App.PageData` stops being commented out**, and it acquires exactly one optional field. The reader is the layout, which sees the data of whichever page is showing and therefore cannot be typed from any one route's load.

- **What this does not decide** is whether two chromes share components. Probably some (typography, a shell) and not the pieces that name an account or a connection, but that is for whoever has both in front of them. The rule that survives either answer is the absence rule above.
