---
title: A late auto-connect restore no longer signs the previous account back in (@etherplay/connect 0.17.2)
type: task
status: done
created: 2026-11-17
from: the template-tree plan (`docs/plans/template-tree-features.md` on `work`), step C1a, added by the maintainer on 2026-11-17; template-commit-reveal's finding `a-stored-account-auto-connect-lands-after-a-later-switch` (worked around in its hotseat, not fixed here)
---

# A late auto-connect restore no longer signs the previous account back in

## Why

At construction, a connection with `targetStep: 'SignedIn'` restores the origin account it last stored, but only after asking the wallet `eth_chainId` and `eth_accounts`. Up to `@etherplay/connect` 0.17.0 that restore checked nothing when it landed. With a wallet that holds several accounts and answers slowly (an embedded world's in-tab chain while it boots), a person selected and signed in before the restore landed was overwritten by the stored account, and `useCurrentAccount` then followed the wallet back to them WITHOUT a signature: the app was left with no signer. template-commit-reveal's hotseat met it after a reload mid commit phase and worked around it in `$lib/game/lobby/hotseat.ts`; that workaround stays.

0.17.1 (etherplay-connect 77afb17 and 387bde5) makes every slow attempt (the auto-connect, `connect`, `selectWallet`, `requestSignature`) publish only if nothing moved the flow since it asked, and makes `useCurrentAccount`'s follow prefer its address instead of demanding it. 0.17.2, published sixteen minutes later, changes no behaviour: connect-core takes `originPublicKeyPublicationMessage` from `delegated-identity` 0.1.1 (the text unchanged, byte for byte), which adds that one small package to the tree. The bump goes to 0.17.2 so the template does not lock a patch superseded the same day (decided with the maintainer, 2026-11-17).

## Done, 2026-11-17, on local preview branches `tf-C1a/*`

**`main`** (from `origin/main` 24fabcd9): 501af59f `"@etherplay/connect": "^0.17.2"`, the lockfile at connect 0.17.2, connect-core 0.7.5 and delegated-identity 0.1.1 and nothing else; 420fde56 its `pnpmDepsHash`. The changes from 0.17.0 move no type, option or default this repo uses (the publication message is re-exported where it was, and nothing here imports it), so no call site changed.

**`with/embedded-chain`**: c8d2dd31, a case in `web/test/lib/embedded/wallet-switch.svelte.test.ts` (client project, real Chromium), "a reload whose restore lands late". A previous visit signs in as A through a world's connection (`embeddedConnectionFactory`, a two-account wallet), which stores A; the reload builds a new wallet and connection over a node that HOLDS `eth_chainId` (the node, a bare `request`, rather than the wallet, whose `on`/`removeListener` must reach the connection untouched), so the restore of A waits; B is selected and signed in; then the node answers. The connection must still be SignedIn as B with B's signer, and no state after B's sign-in may name A. **Red on 0.17.0** (the lockfile of `origin/with/embedded-chain` installed for the run): `expected 'WalletConnected' to be 'SignedIn'`, exactly the downstream symptom, the restore having published A and the follow having gone back to B with no signer. Green on 0.17.2, three runs out of three.

**Cascaded** by merge, never a rebase: `main` into `with/local-signer` 7feea40d (clean), `with/embedded-chain` 0afd2b20 (+ 6a9b5812 hash) and `website` cedf7766 (+ bf940db8 hash); `with/local-signer` into `with/hosted-account` 9dd58863 (+ 29f5083f hash); `with/local-signer` then `with/embedded-chain` into `integration` 9807abdb, a47f26ef (+ 2810d63d hash). Conflicts only on the `pnpmDepsHash` line (each node's own kept, then recomputed), and on `web/package.json` and the lockfile where a node adds a dependency beside the bumped line (`with/embedded-chain`, `with/hosted-account`, `integration`: the node's file with the bump applied, the lockfile as `--ours` then `pnpm install --config.resolution-mode=lowest-direct`, each resulting in the same 22-line lockfile change as `main`'s).

Not here: everything below jolly-roger, and closing template-commit-reveal's finding; that is step C1b of the plan.

## Measured

Each node's verify (`pnpm install && pnpm --filter ./web check && pnpm --filter ./web run test:unit`) before and after, svelte-check 0 errors and 0 warnings throughout; server / client test counts:

| node | before (origin head) | after |
|---|---|---|
| `main` | 1047 / 44 | 1047 / 44 |
| `with/local-signer` | 1318 / 58 | 1318 / 58 |
| `with/hosted-account` | 1318 / 58 | 1318 / 58 |
| `with/embedded-chain` | 1090 / 49 | 1090 / 50 (the new case) |
| `integration` | 1361 / 63 | 1361 / 64 (the new case) |
| `website` | 1047 / 44 | 1047 / 44 |

Every node locks `@etherplay/connect` 0.17.2. `check-stem-drift` and `check-omissions` pass on every node against its stem's preview head (`main` against `stem/main`; `integration` against both stems). Each `pnpmDepsHash` recomputed with `nix build git+file://...#lan.pnpmDeps` (`with/local-signer`'s unchanged).

**The pushes** (fast-forwards of the `origin` heads they were branched from): `main` 24fabcd9..420fde56, `with/local-signer` 1e3f5fb9..7feea40d, `with/hosted-account` 28d2d6bb..29f5083f, `with/embedded-chain` 2de378b0..c8d2dd31, `integration` 8ce73613..2810d63d, `website` d73a19a3..bf940db8, `work` (this file).
