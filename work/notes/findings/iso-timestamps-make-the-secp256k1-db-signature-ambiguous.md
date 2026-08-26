---
title: An ISO-8601 timestamp in synced data makes the secp256k1-db signature ambiguous, so with/sync cannot ship on the current encoding
type: finding
status: spotted
created: 2026-08-26
source: enumerated every valid re-split of `put:${ns}:${counter}:${data}` against realistic synqable payloads, checking the counter segment against the server's own `BigInt(c).toString() === c` normalisation
affects: secp256k1-db KNOWN-ISSUES.md issue 2, with/sync (service-layers PRD, Wave 2)
---

# The luck that was holding runs out on the first dated record

`secp256k1-db` signs the message `put:${namespace}:${counter}:${data}`, built by concatenation with no escaping and no lengths. Its own `KNOWN-ISSUES.md` issue 2 records that this can be re-split, so one signature authorises a write to a different namespace, and assesses current exposure as follows:

> **Current exposure is nil, and that is luck rather than design.** [...] I scanned 20 live records for alternative valid splits and found zero, and none of their `data` values contains a colon at all. So today's data is fine, and the day an app stores `"<timestamp>:<payload>"` it is not.

That assessment is correct and its conclusion is too narrow. The dangerous pattern is not a leading `"<timestamp>:"`. It is **any** `:<normalised-decimal>:` occurring anywhere in `data`, because the re-split can take its counter from any colon-delimited segment and fold everything before it into the namespace.

An ISO-8601 timestamp contains exactly that pattern, and account data is full of ISO-8601 timestamps.

## Verified

Enumerating every `(ns', counter', data')` that reconstructs the identical message, and keeping those whose counter segment satisfies the server's own normalisation check (`/^[0-9]+$/` and `BigInt(c).toString() === c`), against `ns = "jolly-roger-0xAbC"` and a millisecond counter:

| payload | result |
|---|---|
| `{"greeting":"hi","n":42,"ok":true}` | safe |
| `{"remindAt":"12:30"}` | safe |
| `{"operations":[{"hash":"0xdead","at":"2026-08-26T09:05:00Z"}]}` | safe |
| `{"lastSeen":"2026-08-26T14:30:00Z"}` | **vulnerable** |

The vulnerable split:

```
ns'      = jolly-roger-0xAbC:1786793052791:{"lastSeen":"2026-08-26T14
counter' = 30
data'    = 00Z"}
```

`30` is a two-digit minute with no leading zero, so it round-trips through `BigInt` unchanged and the server accepts it. `05` does not (`BigInt("05").toString()` is `"5"`), which is the only reason the third row is safe.

**So the exposure is decided by the minute field.** ISO-8601 minutes are always two digits, zero-padded. Minutes `00` to `09` carry a leading zero and fail normalisation; minutes `10` to `59` pass. Fifty of sixty minutes are vulnerable, so a record carrying a single ISO timestamp has roughly a **5 in 6** chance of being re-splittable, and a record carrying several is vulnerable in practice always.

The same reasoning applies to the seconds field, which doubles the number of candidate splits per timestamp without changing the conclusion.

## Why this blocks `with/sync` rather than merely annoying it

`synqable` pushes the whole store as one blob. Account data is exactly the kind of data that carries `lastSeen`, `updatedAt`, `syncedAt` and per-record timestamps, and the natural serialization for a timestamp in JSON is an ISO string. So the vulnerable pattern is not a corner case an app might hit, it is the default shape of the payload this layer exists to sync.

The impact is spoofing and spam rather than corruption: an attacker harvests the signature (reads are public, `wallet_getString` returns it), then replays it into a namespace derived from the victim's, where the stored counter is `0` so any low counter passes. The victim's data appears in namespaces the victim never wrote, attributed to the victim's address, without the attacker holding the key. Existing records are not damaged.

**The cost of the fix is fixed, and the cost of delay is not.** Any sound encoding (length-prefixed fields, a hash of the fields, or EIP-712 typed data, which additionally gives wallets something readable to show) changes every signature. That needs a new method name such as `wallet_putString2` with the old one honoured during migration, or a version marker in the params. Doing that before `with/sync` has users is a migration nobody experiences. Doing it after is a migration every adopter of the layer experiences, plus every app already on the service.

## Proposed

1. **Fix the encoding in `secp256k1-db` before `with/sync` starts.** Prefer EIP-712: it closes the ambiguity and improves what a wallet shows the user, which matters because this signature is one an ordinary user is asked to produce.
2. **Update issue 2's exposure assessment** from "nil, and that is luck" to "certain for any dated payload", with the minute-field reasoning, so nobody re-derives it from the 20-record scan and reaches the old conclusion.
3. **Record the constraint in `with/sync` regardless of when the fix lands**: the sync payload must not be assumed safe to sign under a concatenated encoding.

## What this does not claim

Nothing here is a break of the signature scheme or of secp256k1. The signature is valid; the message it commits to is ambiguous. Fixing the message encoding fixes it completely, and no key material or existing record is at risk in the meantime.
