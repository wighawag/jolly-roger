# Repainting `core/` without editing it

`core/` ships a default look, and that default is shadcn. For most projects it is the right answer and the way to change it is CSS: roughly a hundred custom properties in `app.css` carry the palette, and two descendant sites (`bleeps`, `mandalas`) have their own distinct identities without modifying a single vendored file.

That mechanism has a ceiling, and it is worth knowing where it is. Look at what decides a button's appearance:

```
base:    "... rounded-md text-sm font-medium transition-all gap-2 shadow-xs ..."
variant: "bg-primary text-primary-foreground hover:bg-primary/90"
size:    "h-9 px-4 py-2"
```

The `bg-*` and `text-*` classes resolve to variables, so a theme owns them. The **shape, rhythm, elevation, motion and type scale** are hardcoded utilities inside the component. If you need to own those, and an immersive or game UI does, variables will not get you there.

## The `$ui` alias

`svelte.config.js` maps `$ui` to `src/lib/shadcn/ui`. Point it somewhere else and `core/` is painted by that instead:

```js
alias: {
  $ui: 'src/lib/game-ui',
}
```

Nothing under `core/` needs editing. That is the whole point: `core/` is the part you inherit and should not have to fork to change how it looks.

## What a replacement has to provide

This is the contract, and it is short because the widely-used part is wrapped. Everything below is what `core/` imports through `$ui`:

| import                          | used for                              | notes                                                                                         |
| ------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `$ui/button` -> `{Button}`      | every action in `core/`               | reached only through `core/ui/button`, so **you implement one component, not ten call sites** |
| `$ui/dialog` -> `* as Dialog`   | `Root`, `Portal`, `Content`           | reached only through `core/ui/modal`, see the warning below                                   |
| `$ui/card` -> `* as Card`       | `Root`, `Title`, `Description`        | one call site                                                                                 |
| `$ui/alert` -> `* as Alert`     | `Root`, `Title`, `Description`        | one call site                                                                                 |
| `$ui/avatar` -> `* as Avatar`   | `Root`, `AvatarImage`                 | one call site                                                                                 |
| `$ui/popover` -> `* as Popover` | `Root`, `Trigger`, `Content`, `Arrow` | one call site                                                                                 |
| `$ui/spinner` -> `{Spinner}`    | loading states                        | one call site                                                                                 |

`Button` accepts `variant` (`default`, `outline`, `ghost`), `size` (`default`, `sm`, `icon`), `class`, `disabled`, `type`, `onclick` and children. That list is narrower than shadcn's on purpose: it is what `core/` uses, so it is what you have to build.

`cn` is NOT in this table. It is `clsx` plus `tailwind-merge`, which is a Tailwind dependency rather than a UI-kit one, so `core/` takes it from `core/utils/tailwind` and a replacement kit does not have to supply it.

## The one thing not to reimplement

**`Dialog` is different from everything else in that table, and copying its API is not the job.** A dialog owns behaviour, not just paint: focus trapping, restoring focus to the right element after the exit animation, escape and interact-outside handling, and portalling into the correct overlay layer. Getting that wrong is an accessibility bug, and it is subtle enough that this template has already been bitten by it (see the portal comment in `core/ui/modal/modal.svelte`, which documents a bug where every modal silently portalled to `document.body`).

So `core/ui/modal` wraps `Dialog` and owns that behaviour, and eleven components use the wrapper rather than the kit. If your look needs a different modal, prefer changing what `core/ui/modal` RENDERS over supplying a new `$ui/dialog`, and if you do supply one, treat the behaviour as a specification rather than a detail.

## Adding to this

If something in `core/` starts importing a new component from `$ui`, add a row above. A contract that is not written down is one an implementer discovers by running the app and finding a hole.
