---
title: Owning the look without owning the behaviour, and why the seam already half exists
slug: swapping-the-ui-kit-under-core
type: idea
status: incubating
created: 2026-08-22
revised: 2026-08-22
source: counted every `$lib/shadcn` import by entry point across core/, bleeps and mandalas; diffed both games' vendored shadcn against their fork point; read what core/ actually consumes of each component's API
follows: what-a-variant-edits-in-core-is-predicted-by-the-app-context
---

# The look is meant to change; the framework is not

Two goals were being run together and they want different answers.

**Framework portability is NOT a goal, but framework-cleanliness is.** Nobody is moving to React. The reason `core/` should not name SvelteKit is that a component which takes what it needs as a parameter can be rendered and tested without a framework runtime, and reads as a component rather than as part of an app. That work is done: `core/` imports `$app/*` zero times, at every node in the tree, enforced by a test at the root.

**The look IS expected to change**, and not only in colour. The current shadcn presentation is the right default for getting a wallet working. A game with an immersive UI needs to own the shape of every control.

## What the existing evidence says

`bleeps` and `mandalas` both have their own distinct look. Both **modified zero vendored shadcn files**. They retheme entirely through roughly a hundred CSS custom properties in `app.css`, and they use the shadcn modal exactly as it ships.

That works, and it also shows the ceiling. Look at what actually decides a button's appearance:

```
base:    "... rounded-md text-sm font-medium transition-all gap-2 shadow-xs ..."
variant: "bg-primary text-primary-foreground hover:bg-primary/90"
size:    "h-9 px-4 py-2"
```

The `bg-*` and `text-*` classes resolve to CSS variables, so a theme owns them. Everything else, the **shape, the rhythm, the elevation, the motion, the type scale**, is a hardcoded Tailwind utility inside the component. Telling detail: `--radius` IS themable, and bleeps and mandalas both left it at the inherited `0.625rem`. The variable mechanism gives colour, both consumers took colour, and colour is exactly what an immersive UI is least satisfied by.

So the request is real and the current mechanism cannot serve it.

## The seam already exists for the hard case, and that is the whole design

Counted across `core/`, the shadcn surface is **eight entry points across 18 import sites**, and the distribution is the interesting part:

| component | import sites in `core/` | owns behaviour? |
|---|---|---|
| `ui/button` | 10 | no, paints |
| `utils` (`cn`) | 3 | no, merges classnames |
| `ui/dialog` | **1** | **yes**: focus trap, escape, interact-outside, portal |
| `ui/popover` | 1 | **yes**: positioning, dismiss |
| `ui/card`, `ui/alert`, `ui/avatar`, `ui/spinner` | 1 each | no, paint |

`ui/dialog` is imported by exactly one file, `core/ui/modal/modal.svelte`, and **eleven** components use that wrapper instead. The deepest, most behaviour-heavy dependency in the tree is already behind a single shim, which is precisely why bleeps and mandalas can take the modal unchanged and have it work.

That is the pattern to extend, and it is already proven here.

## The distinction that should drive it

A UI kit sells two things and they should be swapped on different terms.

- **Paint**: colour, shape, size, motion, type. Per project. Should be trivially replaceable.
- **Behaviour**: focus trapping, restoring focus on close, escape and interact-outside handling, portalling into the right layer, ARIA wiring. This is the fiddly, accessibility-critical part, it took real work to get right here (see the `Dialog.Content` portal comment in `modal.svelte`, and `work/notes/findings/modal-stacking-is-declaration-order.md`), and **no game should reimplement it to change how a panel looks**.

A wholesale alias swap of `$lib/shadcn` fails on exactly this line: it hands the replacement both jobs, so every new look re-owns focus management, and the first thing a hand-rolled game modal loses is escape-to-close and focus restore. It also forces the replacement to mirror bits-ui's component API (`Dialog.Root`/`Portal`/`Content`, `Alert.Root`/`Title`/`Description`), which is a strange shape to impose on a UI built to be different, and it is all-or-nothing: no keeping shadcn's popover while replacing the button.

## The proposal

Two moves, in this order, and the first is small.

**1. Narrow the contract, by wrapping what is spread out.** `core/ui/modal` already does this for the dialog. The only other widely-spread dependency is `Button`, at 10 sites in `core/` and 21 to 28 in each game. A `core/ui/button` shim, taking the props `core/` actually uses (`variant` limited to the two in use, `size`, `class`, `onclick`), takes the tree's exposure from eight entry points to about four. `Popover` deserves the same treatment when something needs it, on behaviour grounds rather than count. The paint-only singletons (`card`, `alert`, `avatar`, `spinner`) are one site each and are not worth a wrapper.

**2. Point the wrappers at ONE alias, and let the app set it.** `core/ui/*` imports from `$ui` rather than `$lib/shadcn`, with `$ui` resolving to `$lib/shadcn` by default. A game sets it to `$lib/game-ui` in one place. Because step 1 narrowed things, `game-ui` only has to satisfy what the wrappers import, which is a short and enumerable list rather than the whole of shadcn.

The result is the one-line swap, with the behaviour preserved on our side of the line rather than re-bought by every project.

## Cost, and what it is not

Step 1 is under a day: one shim, ten import lines in `core/`, and the same again in each game at cascade time. Step 2 is an alias entry plus documenting the contract. Neither changes any behaviour, so both are verifiable by `check` plus the existing suites.

Worth stating plainly: **this is not the "split core/ by replaceability" option ADR-0005 rejected**, and it does not reopen it. That option moved every core component into a presentation layer, cost the most of anything on the list, and cut across the line that actually predicts modification. This adds one shim to the directory that already holds the modal shim, and changes an import specifier. It also does not compete with ADR-0005: what a variant edits in `core/` is predicted by the app context, not by the UI kit, and that is still the boundary worth enforcing first.

## Still open

`cn` is imported 70 times in each game and 3 times in `core/`. It is `clsx` plus `tailwind-merge`, so it is a Tailwind dependency rather than a shadcn one, and a `game-ui` that still uses Tailwind wants the same function. Probably it should move to `core/utils/tailwind` (which exists) and stop being reached through the kit at all. Cheap, and it removes the largest single number from the table for the right reason rather than by hiding it.
