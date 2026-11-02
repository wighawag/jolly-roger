---
title: Gas tips never below the node's own minimum, which an idle chain's fee history reports as zero
type: task
status: done
created: 2026-11-02
from: stratagems' port plan, step L2 (`join-template-commit-reveal` branch, `work/plans/join-template-commit-reveal.md`), its LAN rehearsal; decided with the maintainer on 2026-11-02
---

# Gas tips never below the node's own minimum

## Why

`core/connection/gasFee.ts` prices every tier's tip from `eth_feeHistory`'s reward percentiles. Those describe what recent blocks PAID, not what the node ACCEPTS. On a quiet chain every recent block is empty, every reward is zero, so every tip is zero, and a node with a minimum tip never mines the transaction: it stays pending for ever, with no error anywhere.

Found on a LAN box running geth 1.17 in dev mode (the maintainer's `ethereum-lan-node`): nothing a page sent was ever mined, while the contracts' deploy (priced from the node's suggestion) was. geth's miner wants a tip of at least 1,000,000 wei, its txpool at least 1, and it will not be configured lower: it rewrites `--miner.gasprice 0` to 1,000,000 and `--txpool.pricelimit 0` to 1 ("Sanitizing invalid ..."). Its `eth_maxPriorityFeePerGas` answers 1,000,000. The same holds on any quiet geth-served chain.

## Done, 2026-11-02, on local preview branches `pl2/*`, NOT pushed

**`main`** (from `origin/main` 434de911): `14e7462e` the tips' floor. `eth_maxPriorityFeePerGas` is asked alongside `eth_feeHistory`, and each tier's tip is at least its answer; a node that refuses the method (or fails) gives no floor, so the estimate is what it was. Where blocks are busy the percentiles are above the floor and nothing changes. On hardhat, which suggests 1 gwei on a chain whose base fee is 0, a local transaction now tips 1 gwei instead of 0. Three unit cases: an idle chain gets the node's floor, a busy chain keeps its percentiles, a node without the method gives no floor.

**Cascaded**, every merge clean: `with/local-signer` b9512acc, `with/embedded-chain` e137aa52, `website` 96655a38, `with/hosted-account` daa99d08, `integration` f62d9f28; then template-commit-reveal (its `main` from `integration`, its six nodes) and its descendants reveal-or-die, bomber-world and stratagems. Not cascaded: bleeps and mandalas (already 281 commits behind their stem, so a cascade would bring all of those) and template-zk-game with duel-in-the-dark; each takes it with its next cascade.

## Measured

Check 0 errors and 0 warnings on every branch; unit, the three new cases included: `main` 1025 + 44, `with/local-signer` 1292 + 58, `with/embedded-chain` 1063 + 46, `website` 1025 + 44, `with/hosted-account` 1292 + 58, `integration` 1330 + 60. Below, every template-commit-reveal node and descendant +3 from it (+2 more from a lobby fix in the same batch). The LAN rehearsal that found it now plays a table end to end against stock geth flags.

**The pushes**, every one a fast-forward of the `origin` head it was branched from: `main` 434de911..14e7462e, `with/local-signer` 08938fec..b9512acc, `with/embedded-chain` 3295d314..e137aa52, `website` d22affba..96655a38, `with/hosted-account` 74c84352..daa99d08, `integration` 2ca4cf64..f62d9f28, `work` (this file).
