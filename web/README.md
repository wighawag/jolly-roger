# Jolly Roger Frontend

The frontend is build on svelte-kit

It makes use of STORES (object with a suscribe method) whenever possible.

This let it be easily integrated in svelte files (`$<store>` syntax) but also make it ultimately agnositc to teh frontend framework you use if any.

For onchain app and games there is a common pattern:

- get data from indexer
- apply local data
- apply pending tx

Furthermore, it is often the case that some local data need to be kept hidden

## Architecture

Jolly-Roger supports all of this and is architect around this same patterns

The blockchain folder handle the indexed State. it make of [ethereum-indexer] to have the indexing run in the browser.

This is handled in [src/lib/blockchain/state/State.ts] by providing few STORES.

One simply called `state` represent the onchain state already included in the blockchain.

This State is then merge witj both local data and pending tx to create the ViewState
