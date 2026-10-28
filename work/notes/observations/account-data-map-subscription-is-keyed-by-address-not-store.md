---
title: subscribeToAccountDataMap re-subscribes on a new ADDRESS, not on a new store, so a signer change for the same address keeps the stopped store's events
slug: account-data-map-subscription-is-keyed-by-address-not-store
type: observation
status: open
created: 2026-10-28
---

# Keyed by address, while synqable makes a store per account AND key

`web/src/lib/core/utils/data/account-data-subscription.ts` tears down and re-subscribes only when `currentAccountData.account` differs from the last one. synqable's multi-account store creates a NEW store whenever the account OR its private key changes (`isSameAccountOrSigner`), and since 0.2.0 stops the old one terminally. With an account store that carries a signer (`AccountWithSigner`, which encryption needs), a key change for the same address would leave the observer subscribed to the stopped store's events and never to the new one's, so new operations would not reach the transaction observer until the next address change.

Not reachable today: jolly-roger's `AccountStore` is a plain address (`Readable<Account>`), so a key change never happens. It becomes reachable the day the account data is encrypted (`with/sync`, which hands the account's key to the storage adapter). The fix is to compare the store object rather than its `account`. Found while moving the account data to synqable 0.2 (task `account-data-on-synqable-0.2`); `account/lifecycle.ts` follows the store object for the same reason.
