---
title: An action during a reload joins the stored session's restore instead of asking to sign in again (@etherplay/connect 0.17.3)
type: task
status: done
created: 2026-11-17
from: the template-tree plan (`docs/plans/template-tree-features.md` on `work`), step C1a2, decision C1-11, decided by the maintainer on 2026-11-17; found by step C1b in template-commit-reveal's `web/e2e/tests/table.e2e.ts`
relates-to: work/tasks/done/a-late-auto-connect-restore-no-longer-signs-the-previous-account-back-in.md
---

# An action during a reload joins the restore instead of asking to sign in again

## Why

`@etherplay/connect` 0.17.1 (77afb17, taken here as 0.17.2 by C1a) made the auto-connect at construction drop its result if anything moved the flow while it waited on the wallet, which fixed a stored account being restored over a later switch. It also counted an `ensureConnected()` or `connect()` made in that window as "moving the flow", so the call overtook the restore and started a sign-in of its own: the account picker, and a signature asked again for the account that was signed in all along. Every app action calls `ensureConnected()`, so a person who clicks while a page is still loading met it. template-commit-reveal's `table.e2e.ts` did (reload, create a table at once: a "Confirm sign in" dialog and a 90 s timeout), on 0.17.2 and not on 0.17.0; jolly-roger's own suites did not, since none of them acts during a load.

0.17.3 (etherplay-connect d295e11, and b4b92ad from its review; released 2026-11-17) makes a call that names nothing new JOIN the restore in flight: `ensureConnected()`, `ensureConnected(step)`, and `connect()` with no mechanism or the restore's own wallet and account, wait for it and carry on from where it landed (landed SignedIn as the stored account, they resolve at once and ask nothing; landed short, they drive on). Another wallet, another account, a hosted mechanism, `selectWallet` and `disconnect` still win, as 0.17.1 made them. Its dependencies are 0.17.2's.

## Done, 2026-11-17, on local preview branches `tf-C1a2/*`

**`main`** (from `origin/main` 420fde56): 31c27960 `"@etherplay/connect": "^0.17.3"`, the lockfile changing that one package (10 lines); c34fa2ce its `pnpmDepsHash`. No call site changed.

**`with/embedded-chain`**: 24b667bf, a case in `web/test/lib/embedded/wallet-switch.svelte.test.ts`, "a reload that acts at once". A previous visit signs in as A through a world's connection, which stores A; the reload builds a new wallet and connection over a node that holds `eth_chainId`, so the restore of A waits; `ensureConnected()` is called, as an app action calls it; then the node answers. The call must resolve within 5 s, the connection must be SignedIn as A with A's signer (the key of the previous visit), and no state may show `MechanismToChoose`, `WalletToChoose`, `ChooseWalletAccount` or `WaitingForSignature`. **Red on 0.17.2** (the lockfile of `origin/with/embedded-chain` installed for the run, twice): `expected 'still waiting' to be 'resolved'`, the action left waiting for a sign-in nobody asked for. Green on 0.17.3, three runs out of three. C1a's case beside it (an explicit switch to B still wins over the restore) passes unchanged.

**Cascaded** by merge: `main` into `with/local-signer` 1a78033a (clean), `with/embedded-chain` b4993552 (+ e0f68b57 hash) and `website` dadfaf95 (+ e024f10b hash); `with/local-signer` into `with/hosted-account` 2f5cbbbe (+ 9d3013c5 hash); `with/local-signer` then `with/embedded-chain` into `integration` b31db990, b3e47203 (+ 50112668 hash). Conflicts only on the hash line, and on `web/package.json` and the lockfile where a node adds dependencies beside the bumped line (the node's file with the bump, the lockfile `--ours` then `pnpm install --config.resolution-mode=lowest-direct`, each the same 10-line change). `git rerere` replayed C1a's resolutions at `integration`; each was read and redone by hand.

## Measured

Each node's verify before and after, svelte-check 0 and 0 throughout; server / client:

| node | before | after |
|---|---|---|
| `main` | 1047 / 44 | 1047 / 44 |
| `with/local-signer` | 1318 / 58 | 1318 / 58 |
| `with/hosted-account` | 1318 / 58 | 1318 / 58 |
| `with/embedded-chain` | 1090 / 50 | 1090 / 51 (the new case) |
| `integration` | 1361 / 64 | 1361 / 65 (the new case) |
| `website` | 1047 / 44 | 1047 / 44 |

Every node locks 0.17.3. `check-stem-drift` and `check-omissions` pass on every node against its stem's preview head. Every `pnpmDepsHash` builds (`with/local-signer`'s unchanged). **The full e2e of the six nodes**, the first on 0.17.x (2026-11-17, three at a time, each with its own ports and TMPDIR): `main` 59, `with/local-signer` 65, `with/hosted-account` 67, `with/embedded-chain` 59, `integration` 65, `website` 59, all passed, the same counts as L1b's baseline.

**The pushes** (fast-forwards of the `origin` heads they were branched from): `main` 420fde56..c34fa2ce, `with/local-signer` 7feea40d..1a78033a, `with/hosted-account` 29f5083f..9d3013c5, `with/embedded-chain` c8d2dd31..24b667bf, `integration` 2810d63d..50112668, `website` bf940db8..e024f10b, `work` (this file).
