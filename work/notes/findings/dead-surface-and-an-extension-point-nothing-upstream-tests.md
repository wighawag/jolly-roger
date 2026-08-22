---
title: "\"Dead in all four branches\" was the wrong test: push-notifications is not jolly-roger's to delete"
type: finding
status: spotted
created: 2026-08-22
revised: 2026-08-22
source: an export-reachability pass over src/lib/core, then `git log -S` across all refs and `git ls-tree` against the `stem` remote
---

# Two kinds of unused code, and I got the first one wrong

A reachability pass over `src/lib/core` finds 94 exports not imported by any other file under `src`. Most are types (a module's public vocabulary, correctly exported whether or not a consumer names them today) or pure primitives exercised directly by their own tests, which `wallet-activity-boundary.test.ts` argues for explicitly. Two real cases survive the filter, and they are opposites.

## `core/service-worker/push-notifications/`: unused here, and NOT ours to delete

**329 lines** (`index.ts` 315, `utils.ts` 14), exporting `createPushNotificationService`, `PushNotificationService`, `PushNotificationsState` and `SettledPushNotificationsState`. No importer outside its own directory on `main`, `with/local-signer`, `with/hosted-account` or `website`. No test. `git log --all -S"push-notifications"` over every ref finds no importer at any point in history: it has never been wired, anywhere, since it arrived in `62cbfc4` ("PWA", 2025-11-29).

The first version of this note recommended deleting it. That recommendation was wrong, for two reasons, and the second one is disqualifying.

**It measured the wrong population.** "Unused by us" and "unused by adopters" are different claims and only the first was measured. A template's unused code is not automatically waste; the whole product is code somebody else will use. The house pattern for this repo is documented removability, not deletion, and `core/transaction/README.md` is the worked example: it explains a subsystem AND walks a reader through taking it out in twenty minutes, naming the eight files that reference it. That paragraph is worth more than the deletion would have been.

**It is inherited, so deleting it here is a change landed below its home.** `push-notifications/` exists on `stem/main`, which is `template-svelte-shadcn`, jolly-roger's parent:

```
$ git ls-tree -r --name-only stem/main | grep push-notif
web/src/lib/core/service-worker/push-notifications/index.ts
web/src/lib/core/service-worker/push-notifications/utils.ts
```

It is unwired there too. Deleting it on jolly-roger's `main` would produce a modify/delete conflict on every future fanout from the parent, at every level, forever, paid by whoever happens to be cascading something unrelated. That is exactly the failure the reconciliation skill describes, and this note nearly walked into it while quoting the same rule at other people.

**The general point, which is larger than this directory.** `core/`'s framework-agnostic subset is **co-owned with the parent template**, and changes flow both ways: `da43158` on this tree is literally "core: sync framework-agnostic drift from jolly-roger". `stem/main`'s `core/` holds `notifications/`, `service-worker/` (including this directory), `utils/web`, `utils/tailwind` and a `config.ts`, all of which jolly-roger either has or has relocated. So `core/` is not a jolly-roger directory that descendants inherit; it is a **shared directory with an owner above jolly-roger for part of its contents and below it for the rest**. Nothing in the tree records which files are which, and that is the real finding here.

**What to do instead:** write the `core/transaction/README.md` treatment for it, and write it at the home. A short `core/service-worker/push-notifications/README.md` on `template-svelte`, the ROOT, saying what it does, that it is deliberately unwired, what wiring it requires (a VAPID key, a subscription endpoint, a server), and how to delete it if unwanted. This note originally said `template-svelte-shadcn`, which was one level too low: the directory exists at the root with tree SHA `e8cdadaa` identical at all eight nodes, so writing it at shadcn would leave `template-svelte` and `-tailwind` and `-blog` without it. The home is the root, which is also the "PWA Ready" template and therefore where an unwired push service is on theme. That cascades down to jolly-roger and to every other descendant for free, and it is the difference between 329 lines a reader has to reverse-engineer and 329 lines a reader can use or remove in an afternoon. Cost: an hour, at the right level. If it were mine to delete I would still not delete it: VAPID subscription handling is fiddly enough that reconstructing it is a worse day than ignoring it.

Related, and now stale: `work/notes/observations/signer-balance-store-appears-unused.md` records a 2026-07 decision to KEEP `signerBalance.ts` as a documented unwired building block, on the rationale that "it is idiomatic for this template to ship unwired `lib/core` building blocks". A month later it was deleted in `d537e7d` ("web: make this the wallet-connected template, and only that"). That note is the only written statement of policy on unwired building blocks and it now says the opposite of what the repo did. Worth an update, and worth noticing that the co-ownership above is probably why the two decisions differ: `signerBalance.ts` was jolly-roger's own and could be deleted freely; `push-notifications/` is not.

## The opposite problem: `createPaymentRail` is used by a descendant and tested by nobody upstream

`core/connection/remote.ts` exports `createPaymentRail`, `createPaymentConnection`, `PAYMENT_STORAGE_PREFIX` and the `PaymentRail` type, roughly 90 lines with a long and excellent doc comment. On `main`, nothing outside `remote.ts` and a re-export in `types.ts` references any of it, and no test does. On `with/local-signer` it is imported by `context/index.ts:223`.

This is a **deliberate upstream extension point** and it works: `remote.ts` has conflicted exactly once in 44 merges, and the merge that created this shape is on record ("take targetStep in remote.ts, and build the payment rail here instead"). The alternative was the variant forking `establishRemoteConnection`. Good decision, keep it.

The gap is the test. `main` runs 684 unit tests and not one constructs a payment rail, so a change to `remote.ts` on `main` can break `with/local-signer` while `main` stays green. The descendant's 941 tests catch it, but only at cascade time, which is when nobody wants to be debugging a connection factory.

**The rule this suggests:** an extension point placed upstream for a downstream consumer is only real if upstream can tell when it breaks. Otherwise it is a promise with no way of noticing it was broken. A construction smoke test suffices, because the rail is dormant by design (`autoConnect: false`, "constructing it talks to nobody and raises no wallet prompt"): construct one from fake chain info, assert it yields a connection and two clients, assert no network call.

Same question is worth asking of `SignerClientFactory` and `memoiseSignerClient` in `core/connection/executor.ts` (unused on `main`; `executor.ts` conflicts twice) and `OptionalSignerStore` in `core/connection/types.ts`. `executor.ts` is at least reached by its own test file; whether the signer-factory path specifically is exercised on `main` wants ten minutes with coverage on.

## The distinction worth keeping

Unused code in a template is not waste by default. There are now **four** kinds, not three, and the fourth is the one this note learned:

- **An extension point a descendant uses.** Keep, and test it upstream, because upstream is where it will be broken.
- **A building block nobody uses yet, owned here.** Keep only with a header saying so and a test. That is the `signerBalance.ts` treatment, and note the repo later moved away from wanting these at all.
- **Neither, and owned here.** Delete.
- **Anything owned ABOVE here.** Not ours to decide. Document it at its home or leave it; deleting it locally buys a conflict at every future fanout.

Nothing in the tree currently distinguishes the four from the outside, which is why 329 inherited lines sat next to a load-bearing 90 and both looked the same.
