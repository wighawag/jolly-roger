---
title: "`fatal.test.ts` \"is unset for a valid configuration\" times out on its 30s cold import, roughly one run in ten"
slug: fatal-test-cold-import-timeout
type: observation
status: open
created: 2026-08-22
follows: delegation-e2e-flakes-under-full-run
---

# The unit-suite entry in the load-sensitive tally, with a note of its own at last

`work/notes/observations/delegation-e2e-flakes-under-full-run.md` closes with a tally of load-sensitive failures and lists this one as "still has no note of its own". This is that note.

Seen again while establishing a baseline before an audit pass, on a clean `main` (`a64e478`) with no working-tree changes:

```
run  1      684 passed          (the baseline itself)
run  2      683 passed, 1 failed
runs 3-12   684 passed          (ten consecutive clean runs)
```

Roughly one in eleven. The failing run's name was not captured at the time, which was a mistake and is recorded as one, but the identification is not in serious doubt: `test/lib/context/fatal.test.ts` is the only unit test in the suite with a bespoke timeout, and it is already named in the tally as having failed this way at least twice before.

## Why this test and no other

The file's own comment says it plainly:

```ts
// Each case re-imports the context module (and with it the whole app barrel)
// to pick up a different mocked env, which costs more than the 5s default.
const IMPORT_TIMEOUT = 30_000;
```

`$env/static/public` is inlined at build time, so the only way to exercise a different environment is `vi.resetModules()` plus `vi.doMock` plus a fresh `await import('$lib/context/index')`. That import pulls the entire app barrel: the route handler, the notifications service, the service-worker registration module, the connection stack, the account store, every core module they reach. Three cases each pay it from cold. A 30s budget for a module graph that size is not generous, it is the same "within a small factor of the limit even when nothing else is competing" shape the e2e note diagnoses for `delegation.e2e.ts` and `demo.e2e.ts`, one layer down.

So the diagnosis in that note extends here: this is not a race and not a flaw in the assertions, it is a timeout budget set against a faster machine than the one running it, on a workload that is unusually heavy for a unit test.

## Three ways out, cheapest first

**Raise `IMPORT_TIMEOUT`.** One number. Buys quiet, admits nothing, and makes a slow test slower to fail. Reasonable as an immediate stopgap and worth doing if the next occurrence blocks a cascade.

**Stop re-importing the app barrel.** The test re-imports the world because the thing it wants to vary, configuration, can only be varied by re-instantiating everything that reads it. That is a symptom of the shape ADR-0006 (proposed) is about: if `PUBLIC_*` were parsed once into a constructed object, this test would build three config literals and call `createContext(config)` three times with no `resetModules`, no `doMock`, and no cold import at all. The flake would not be mitigated, it would be structurally absent. **This is the strongest single piece of evidence for that ADR and it should be cited there**, because it is the only place the current arrangement costs something measurable rather than merely tidy.

**Leave it and accept a red run in ten.** Rejected. It is not the cost of the failure, it is the cost of the judgement call: every red full run becomes a question about whether the red matters, which is the exact tax the e2e note describes and the exact thing a suite exists to remove. It matters more now that `pnpm --filter ./web test:unit` runs as part of the tree's `verify` command, since a one-in-ten unit flake will eventually fail during a cascade and send someone hunting a merge that was fine.

## For next time

Capture the failing test's name. A summary line saying one test failed, without which one, is a datum thrown away, and it cost eleven re-runs here to get back to a worse answer than the first run would have given.

Reproduce with full output kept per run:

```sh
cd web
for i in $(seq 1 20); do pnpm vitest run --reporter=verbose > /tmp/jr-flake-$i.log 2>&1 || break; done
```

## Seen again 2026-08-22, and this time the load was the cause rather than a guess

It appeared once during a verification sweep that ran `check` plus the full unit suite across eleven nodes back to back, on `with/local-signer` (947 of 948). Three immediate re-runs on the same tree: 948, 948, 948.

That is the first observation of it under a KNOWN load rather than an unexplained one, and it lines up with the measurement taken while reviewing ADR-0006: the case `is unset for a valid configuration` runs 13.3s to 17.3s against its bespoke 30s budget across ten measured runs, so it needs less than a 2x slowdown to fail. A sweep that keeps a full suite running continuously is exactly that slowdown.

Two things follow. The frequency figure ("roughly one in eleven") is still unreplicated as a rate and should not be cited as one; what IS reproducible is the duration against the budget, and that is the number to argue from. And this is the shape the cascade will produce: `verify` runs `pnpm --filter ./web test:unit` on every merged node, so a tree-wide cascade IS a sustained-load run, and this test is the one that will fail in it. That is not a hypothetical any more, it is what just happened.
