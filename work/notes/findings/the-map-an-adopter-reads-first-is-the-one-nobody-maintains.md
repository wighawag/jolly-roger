---
title: The three documents an adopter reads first are the three nobody maintains
type: finding
status: spotted
created: 2026-08-22
source: read the repo as a day-one adopter and as a day-ninety maintainer, then checked every navigational claim against the tree
---

# Excellent documentation, none of it on the path in

The in-code documentation in this repository is unusually good. `core/transaction/README.md` explains a subsystem AND how to delete it, and its removal guide is still accurate after the subsystem grew. `kit/README.md` states a rule, names the test that holds it, and explains why the rule is about imports rather than layout. Sixty-five call sites cite an ADR by number, in the deliberate form "ADR-000N (`work` branch)" so a reader knows where to look. Comments explain the bug that produced the code, not the code.

None of that is reachable from the front door.

## Day one: the adopter

They clone the repo and open `README.md`, 397 lines. It is a good operational README: setup, dev modes, deploy, verify, publish. Three things it does not do.

**It never mentions that a design record exists.** Zero occurrences of "ADR", "docs/adr" or "work branch" in `README.md`, `web/README.md` or `web/TESTING.md`. Discovery of the ADRs is therefore entirely accidental: you find them only by opening a source file that happens to cite one. Sixty-five citations point somewhere the entry document never names. The orphan-branch arrangement is a good decision (it never cascades, it never conflicts) and the citation form is well chosen, but it is one line short of being discoverable: the README needs to say that the ADRs live on `work` and how to read one, exactly as `capabilities/README.md` already does.

**Its project-structure block is stale, in the direction that matters.** It lists two entries under `web/src/lib`:

```
│   │   ├── core/             # Core utilities (notifications, service worker)
│   │   └── deployments.ts    # Auto-generated contract deployments
```

`lib/` actually holds sixteen entries. Missing entirely: `kit/` (the framework seam, the one part of the tree with an enforced boundary and a README explaining it), `context/`, `ui/`, `view/`, `onchain/`, `account/`, `metadata/`, `shadcn/`, `capabilities` (under `core/`). And `core/` is described as "notifications, service worker", which is 109 files ago. The single most load-bearing directory in the template is summarised by two of its subdirectories, and the second-most is not mentioned.

**Its Environment Variables section documents the wrong half.** The table lists `ETH_NODE_URI_<network>`, `MNEMONIC_<network>`, `MNEMONIC`, `ETHERSCAN_API_KEY`: the contracts side. The web app reads **thirteen** `PUBLIC_*` variables (`PUBLIC_NODE_URL`, `PUBLIC_CHAIN_INFO_NODE_URL`, `PUBLIC_WALLET_HOST`, `PUBLIC_USE_BURNER_WALLET`, `PUBLIC_IMPERSONATE_ADDRESSES`, `PUBLIC_USE_INTERNAL_EXPLORER`, `PUBLIC_EXPLORER_BLOCK_INDEX_ENABLED`, `PUBLIC_ENS_NODE_URL`, `PUBLIC_FAUCET_API`, `PUBLIC_FAUCET_LINK`, `PUBLIC_OPERATION_RETENTION_DAYS`, `PUBLIC_ENABLE_SW_IN_DEV`, `PUBLIC_ERUDA_PLUGINS`) and not one is documented. Twelve are in `.env`; `PUBLIC_ERUDA_PLUGINS` is in neither `.env` nor the README, and is substituted into `app.html` through `%sveltekit.env.*%`. An adopter configuring their deployment reads the section titled "Environment Variables" and learns nothing about the variables their frontend needs.

**`web/README.md` is still the `sv` scaffold boilerplate.** "# sv / Everything you need to build a Svelte project, powered by `sv`." That is the file a frontend developer opens the moment they `cd web`. It tells them how to run `npx sv create`.

## Day ninety: the maintainer

They are looking for where a kind of thing lives. Components currently live in seven places with no stated rule:

```
lib/core/ui/**            Address, TransactionHash, modal, FaucetButton
lib/core/<domain>/*.svelte ConnectionFlow, the four transaction modals, NotificationCard
lib/ui/**                 navbar, banners, pending-operation, debug
lib/components/           NavigationProgress  (one file)
lib/icons/                GitIcon             (one file)
lib/metadata/             DefaultHead
lib/debug/                TxObserverDebugOverlay
```

with `lib/debug/` and `lib/ui/debug/` both existing and holding different things, and `lib/metadata/DefaultHead.svelte` sitting next to `lib/core/metadata/Head.svelte`. Nothing predicts which of these a new component goes in. The directory names do not predict contents in either direction: `core/` contains app-coupled modals (see the separate note), and `components/` contains one component while `ui/` contains eighteen.

This is cosmetic compared to the boundary question, and I would NOT reorganise it for its own sake. It is worth recording because the fix falls out of the `core/` move for free: once the seven app-context-reaching files leave `core/` for `lib/ui/`, the rule becomes statable in one sentence ("`core/` does not know this app; `lib/ui` does"), and `components/`, `icons/`, `metadata/` and `debug/` can be folded into `lib/ui/` in the same pass at almost no extra cost.

## The app context, since the prompt asks

`Context` has 27 members and is reachable from any component via `getAppContext()`, which is the classic shape of a god object. It is not behaving like one, and the reason is worth recording rather than assuming the worst: every member carries a doc comment saying whose it is and why it is there, several say what they are NOT (`accountBalance`: "Named for whose it is rather than for the role it plays, so a call site that named the executor it sends from names the matching balance"), and ADR-0001 sets an explicit graduation path out of it ("a member that later proves broadly reusable and independently constructable can graduate into a capability"), which `navigation` and `route` have actually taken.

The real cost is not reachability, it is that its construction is one 591-line function and it is the most-conflicted file in the tree. That is a shape problem, not a membership problem, and it is covered in the merge-tax note. I would not shrink `Context`; I would split how it is built.

## What it costs and who pays

Adopters, on day one, in the way that never gets reported. Someone who cannot find the design record concludes there isn't one and re-litigates a settled decision, which is the specific failure mode this template is most exposed to: four descendant branches whose authors each need to know why `TARGET_STEP` is in source and not env, why the context is synchronous, why overlays come in two named kinds. The ADRs answer all three, at length, and the front door does not mention them.

## Proposed fixes

**1. Four lines in `README.md` (cost: ten minutes, cascade: one trivial conflict per branch).** A short "Design decisions" section: the ADRs live on the `work` orphan branch, read one with `git show work:docs/adr/0004-view-and-system-overlays.md`, and the code cites them by number. This is the highest value-per-minute item in the entire audit.

**2. Regenerate the project-structure block and document the `PUBLIC_*` variables (cost: an hour).** The env table should be generated or at least checked against `.env`, because it will go stale again. If ADR-0006 lands, the config module becomes the natural source of that list and the README can point at it instead of duplicating it.

**3. Replace `web/README.md` with something about this app (cost: twenty minutes).** Or delete it and let the root README be the only one, which is better than a wrong one.

**4. A `src/lib/core/README.md` saying what `core/` means (cost: half an hour, and it should land with ADR-0005 rather than before it).** Writing it before the boundary is decided would just write down the ambiguity.

**5. Nothing about the component-home sprawl on its own.** Fold it into the ADR-0005 move if that happens, and leave it otherwise.
