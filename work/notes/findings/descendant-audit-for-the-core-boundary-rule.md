---
title: "Descendant audit for the core/ boundary rule: one extra violator in the whole tree, and the parent cannot have any"
type: finding
status: spotted
created: 2026-08-22
source: ran the proposed rule against every branch with `git grep -l` over `web/src/lib/core/**`, plus the `stem` remote
follows: what-a-variant-edits-in-core-is-predicted-by-the-app-context
---

# Pricing the rule against the trees it will actually be enforced against

ADR-0005 was written from `main`'s tree. That is not the tree a boundary test gets enforced against: the moment it cascades it runs on four branches plus whatever the parent template sends down, and a rule that fails on a file nobody examined gets its first exception granted under merge pressure by whoever is holding the cascade. So the rule was run everywhere before being landed anywhere.

The rule, precisely: a file under `web/src/lib/core/` may not import the bare `$lib` specifier (`from '$lib'`) or anything under `$lib/context/`. Not `$lib/*`, which would ban `$lib/core/ui/modal` and `$lib/shadcn/ui/button` and stop the tree compiling.

## Result

| branch | core files | violators |
|---|---|---|
| `stem/main` (`template-svelte-shadcn`) | 15 | **0** |
| `main` | 109 | 7 |
| `with/local-signer` | 117 | **8** |
| `with/hosted-account` | 117 | 8 (identical, inherited) |
| `website` | 109 | 7 (identical, inherited) |

Seven on `main`, named in ADR-0005. **Exactly one additional file in the entire tree**, and it is the one the audit predicted from the variant's own instincts:

```
with/local-signer  web/src/lib/core/ui/confirm/ConfirmationModal.svelte
```

`with/hosted-account` inherits it unmodified and adds nothing. `website` adds nothing. There is no third case anywhere.

## The extra violator costs nothing new to decide

`ConfirmationModal.svelte` is the same shape as the seven, down to the details:

- It reads `const {confirmation} = getAppContext()` and renders whatever question is pending.
- It is rendered from `context/AcrossPages.svelte`, exactly like `InsufficientFundsModal` and the rest.
- Its logic half, `core/ui/confirm/confirmation.ts`, imports only `svelte/store` and `$lib/core/ui/overlay`. It is genuinely portable and **stays in `core/`**.

So the split is already latent in the directory: the store is portable, the modal is app UI. The fix is `git mv web/src/lib/core/ui/confirm/ConfirmationModal.svelte web/src/lib/ui/confirm/` on `with/local-signer`, in the same cascade, with no new design decision and no judgement call reserved for whoever is merging. That is the difference between a priced item and a landmine.

## The parent template cannot violate the rule, which makes it free to propose upstream

`stem/main` has **zero** violators, and not by luck: it has no app context at all. `getAppContext` does not exist in that tree, and its `core/` holds only `notifications/`, `service-worker/`, `utils/web`, `utils/tailwind` and a `config.ts` that is its equivalent of this repo's `lib/index.ts` app barrel.

Two things follow. The rule can be proposed at `template-svelte-shadcn` at zero cost, where every descendant of that template inherits it rather than only jolly-roger's four branches. And the rule is not an invention: the parent's `core/` already obeys it, and `91ef28b` ("make core indepenent") is the commit where this repo moved the barrel OUT of `core/` for the same reason, five hundred commits ago. ADR-0005 is that instinct written down and made checkable, not a new opinion.

## One thing the rule does not catch, on every branch

`core/connection/executor.ts` imports `type {TransactionMetadata} from '$lib/account/AccountData'` on all four branches. Type-only, and outside the rule as stated (it is neither the barrel nor the context). It is still a core module naming an app module, and the honest treatment is `KNOWN_LEAKS` with a reason and an intended fix (make it a generic parameter), rather than either widening the rule now or pretending it is not there. Widening the rule to all of `$lib/account` would also catch nothing else: this is the only instance.

`$lib/deployments-store` is imported by five core modules on every branch and is sanctioned by name in ADR-0005, on the evidence that no descendant has ever modified any of those five files.

## Revised cost for ADR-0005

| node | files to move | new decisions required |
|---|---|---|
| `main` | 7 | 0 (ADR-0005 lists them) |
| `with/local-signer` | 1 | 0 (same shape, logic half stays) |
| `with/hosted-account` | 0 | 0 (inherits) |
| `website` | 0 | 0 (inherits) |
| `stem/main` | 0 | 0 (already compliant) |

The unknown that made the item unpriceable is closed: it is eight files across two branches, all of one kind, with the logic/presentation split already visible in each. The remaining risk is mechanical rather than design, and it is the one ADR-0005 already names: do the relocation as a pure `git mv` with no content change, so rename detection reapplies the descendant's modifications at the new path instead of dropping them.
