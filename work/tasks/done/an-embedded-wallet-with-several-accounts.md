---
title: An embedded wallet with several accounts, and a world that selects one
type: task
status: done
created: 2026-11-02
from: stratagems' port plan, step H1 (`join-template-commit-reveal` branch, `work/plans/join-template-commit-reveal.md`), hotseat in the offline world; decided with the maintainer on 2026-11-02 (H1-1 to H1-3)
---

# An embedded wallet with several accounts

## Why

Hotseat (several people at one device, each their own account, against one embedded world) is built at template-commit-reveal `main`. It needs the world's wallet to hold one account per person and to switch which one is active, with ONE connection following the switch the way an online connection follows a player changing account in their wallet. `$lib/embedded/wallet.ts` is this repo's (`with/embedded-chain`) and hard-coded one account, for a reason that still holds for one person: several accounts make a connection show an account picker. The world's connection is built with `useCurrentAccount: 'always'` (`embedded/world.ts`), which skips that picker, so several accounts are safe there.

## Done, 2026-11-02, on local preview branches `ph1/*`, NOT pushed

**`with/embedded-chain`** (from `origin/with/embedded-chain` e137aa52): `e2cb981b`, then `098623c8` (the world's connection factory as its own function, `embeddedConnectionFactory`, so the test builds a connection exactly as a world does against a chain with nothing deployed: the test arrives unchanged in every descendant, and none of them has this app's contracts). `announceEmbeddedWallet({accounts})`, 1 when omitted (today's behaviour); `EmbeddedWallet.accounts` in DERIVATION order whichever is selected (the burner reports the selected account first and persists the selection, so after a reload on a later account its list starts there, and a world staking "the player at index 0" must not get someone else); `select(address)`, the burner's `selectAccount`, throwing for an address it does not hold. `test/lib/embedded/wallet-switch.svelte.test.ts` (client project, real Chromium): the order, the default of one, and THE MEASUREMENT hotseat rests on: a world with a two-account wallet signs in as the first, `select` of the second makes the world's connection reconnect as it by itself (no `ChooseWalletAccount`, no prompt), a signature derives a different browser key, and back to the first derives the first key again. Checked to discriminate: with `select` a no-op the switch case times out.

**Cascaded**: `integration` (merge, clean). Then template-commit-reveal's `main` (from `integration`) and down, with the hotseat itself.

## Measured

Check 0 errors and 0 warnings; unit `with/embedded-chain` 1063 + 49 (from 1063 + 46), `integration` 1330 + 63 (from 1330 + 60).
