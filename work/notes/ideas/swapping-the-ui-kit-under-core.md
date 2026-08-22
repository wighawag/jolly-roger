---
title: Swapping the UI kit under core/, and why the seam is narrower than the file count suggests
slug: swapping-the-ui-kit-under-core
type: idea
status: incubating
created: 2026-08-22
source: counted every `$lib/shadcn` import site under `src/lib/core` by entry point rather than by file
follows: what-a-variant-edits-in-core-is-predicted-by-the-app-context
---

# The UI-kit swap, deferred but no longer hypothetical

ADR-0005 rejected splitting `core/` by replaceability (portable logic and ports on one side, the default shadcn presentation over those ports on the other). That rejection was correct on the evidence available, but it rested on a condition that is stated in the ADR and is now changing: "it optimises for a variant that swaps the UI kit, and **no such variant exists in this tree or is planned**". An adopter replacing shadcn is now an anticipated case, so the condition should be revisited rather than the rejection inherited.

Nothing here is a proposal yet. This note exists so the measurement is on record before anyone designs against a guess.

## The seam is much smaller than the file count implies

The number usually quoted is that 15 of the 20 `.svelte` files under `core/` import `$lib/shadcn`, which sounds like a rewrite. Counted by ENTRY POINT rather than by file, it is 18 import sites across **eight** modules, and one of them dominates:

| shadcn entry point | import sites in `core/` |
|---|---|
| `ui/button` | 10 |
| `utils` (the `cn` class merger) | 3 |
| `ui/dialog` | 2 |
| `ui/spinner` | 1 |
| `ui/popover` | 1 |
| `ui/card` | 1 |
| `ui/avatar` | 1 |
| `ui/alert` | 1 |

Eighteen of the vendored components exist; `core/` reaches seven of them plus `utils`. So the question is not "how do we abstract a UI kit", it is "what do `button` and `dialog` need to look like for this to be swappable", and those two account for 12 of the 18 sites.

Five core `.svelte` files import no shadcn at all (`metadata/Head.svelte`, `ui/modal/basic-modal.svelte`, `ui/ethereum/ImgBlockie.svelte`, `notifications/Notifications.svelte`, `notifications/NotificationOverlay.svelte`), so they are already kit-free and cost nothing.

## What this does not change

The measurement that produced ADR-0005 still stands and should not be re-litigated by this: what a variant EDITS in `core/` is predicted by whether the file reaches the app context, not by whether it imports shadcn, and all six context-reaching components import shadcn so the UI-kit signal carries no independent information. A kit swap is a different goal from reducing merge cost, and it should be justified on its own terms (an adopter's ability to rebrand deeply) rather than on merge arithmetic it will not improve.

Do the app-context boundary first regardless. A `core/` that still contains app-coupled files cannot be evaluated for portability at all, because the app coupling dominates the kit coupling.

## Shapes worth considering, cheapest first

- **Do nothing structural; document the swap.** `core/` keeps shadcn, and a `core/README.md` names the eight entry points above as the surface an adopter replaces, in the `core/transaction/README.md` style that this repo already uses for removability. Costs an hour and makes the swap a known job rather than an archaeology exercise. This is probably the right first move whatever else follows.
- **Narrow the surface before abstracting it.** `ui/button` at 10 sites is most of the problem. If `core/` used one local `Button` wrapper re-exporting the vendored one, the swap surface would drop from eight modules to about three with no abstraction invented and no behaviour changed. Cheap, reversible, and it makes any later decision smaller.
- **Ports and adapters properly.** `core/` declares the component contracts it needs and the app provides implementations. This is the version ADR-0005 priced as costing the most of any option (every `core/` component moves, every import updates, both live descendants take a large conflict). Only worth it if a second kit actually lands, and it should be paid for by that work rather than in advance.

The middle option is the one to think about, because it buys most of the optionality of the third at a fraction of the cost and does not commit to a design.

## Open question that decides it

Is the anticipated adopter swapping the KIT (shadcn for something else, same component vocabulary) or the LOOK (same shadcn, different theme)? The second is already supported through Tailwind and needs nothing. Only the first justifies any of the above, and the answer changes which of the three shapes is right. Worth settling before designing.
