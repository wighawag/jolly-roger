---
title: Genesis-hash chain-reset detector, and trimming the pre-send nonce poll
slug: genesis-hash-nonce-cache-detector
type: idea
status: incubating
created: 2026-07-07
---

# Genesis-hash chain-reset detector (nonce-cache)

Follow-ups for the dev-only wallet nonce-cache detection
(`src/lib/core/connection/nonce-cache.ts`, `nonce-cache-store.ts`), noted while
building it and validated against Rabby in the standalone repro
`github.com/wighawag/wallet-nonce-cache-repro` (see its `HANDOFF.md`).

## 1. A wallet-agnostic, proactive genesis-hash detector

The current detection is reactive: it flags a stale wallet only via the
broadcast-tx nonce (`isStrandedNonce`) after a tx is sent, or via a pre-send
poll that does not work for all wallets.

A cleaner, proactive, wallet-agnostic signal: track the chain's GENESIS HASH per
chainId (e.g. localStorage). When the app connects to a chainId it has
"previously seen" but whose genesis hash has CHANGED, the chain behind that
chainId was reset (a restarted local node). That is exactly the condition under
which wallets keep a stale cached nonce and strand transactions, independent of
any wallet error or any broadcast tx.

Intended UX: a soft, USER-ACKNOWLEDGEABLE notice ("this network looks freshly
reset; your wallet may have a stale nonce and strand transactions, reset the
account in your wallet if sends get stuck"), not a hard error, since resetting a
dev chain is normal. This is the same fix recommended to wallet authors (key the
nonce cache to the genesis hash), applied app-side as a heads-up.

## 2. Trim the pre-send poll pending more wallet coverage

`detectNonceCache` (the pre-send `eth_getTransactionCount` poll comparing wallet
vs node) is CONFIRMED useless for wallets that proxy the read to the node
(Rabby), and only ASSUMED useful for wallets that report a locally-tracked nonce
(older MetaMask). It carries real complexity (the BlockOutOfRange handling too).
If broader wallet testing shows no wallet actually benefits, drop the poll path
and keep `isStrandedNonce` as the single ground-truth signal.

## Status / why not done now

Both need testing across more wallets (only Rabby is measured; MetaMask untested,
see the repro's HANDOFF.md open threads) before committing to a design. The
detection shipped is dev-only and gated, so it is safe to leave as-is and refine
later. Refs: `src/lib/core/connection/nonce-cache.ts`,
`src/lib/core/connection/nonce-cache-store.ts`.
