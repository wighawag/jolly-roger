---
title: parseStandardRevertReason mangles non-ASCII and ignores the ABI offset
type: observation
status: spotted
spotted: 2026-07-01
---

# parseStandardRevertReason mangles non-ASCII and ignores the ABI offset

`web/src/routes/explorer/lib/services/transactionDecoder.ts`, in
`parseStandardRevertReason` (the manual `Error(string)` decoder), two
latent issues spotted while adding characterization tests:

1. **Byte-wise UTF-8 mangling.** The string bytes are turned into a JS
   string with `String.fromCharCode(byte)` one byte at a time:

   ```ts
   for (let i = 0; i < stringHex.length; i += 2) {
       result += String.fromCharCode(parseInt(stringHex.slice(i, i + 2), 16));
   }
   ```

   Each UTF-8 byte becomes its own code point, so any multi-byte
   sequence is corrupted. A revert string like `café` (é = 0xC3 0xA9)
   decodes to `cafÃ©`. ASCII revert reasons (the common case) are fine,
   which is why this has not surfaced.

2. **ABI offset is read but ignored.** `offset` is parsed from the first
   32-byte word and then never used; the code hard-assumes the string
   data begins at byte 64 (offset 0x20). That holds for the canonical
   `Error(string)` encoding, but a non-canonical encoder with a
   different offset would be misdecoded. `length` is also unbounded-
   trusted (no clamp against the actual data length).

## Why it matters

Explorer revert-reason display only. Low severity (revert strings are
almost always short ASCII), but it is hand-rolled ABI decoding sitting
next to viem, which already does this correctly.

## Suggested fix (deferred)

Replace the hand-rolled selector+string parse with viem's
`decodeErrorResult({abi: [{type:'error', name:'Error', inputs:[{type:'string'}]}], data})`
(or `decodeAbiParameters([{type:'string'}], '0x'+data.slice(10))`), which
handles UTF-8 and the offset correctly. Same for `parsePanicError`
(`Panic(uint256)`). The characterization tests added in
`web/test/routes/explorer/transactionDecoder.test.ts` cover the ASCII /
known-code paths and would guard such a refactor; add a non-ASCII case
when doing the fix.

## Refs

- `web/src/routes/explorer/lib/services/transactionDecoder.ts` (parseStandardRevertReason, parsePanicError)
- `web/test/routes/explorer/transactionDecoder.test.ts`

## Update (2026-07-01): FIXED

Fixed in commit `4a60437`. Both hand-rolled parses now use viem's
`decodeAbiParameters` (`[{type:'string'}]` for `Error(string)`,
`[{type:'uint256'}]` for `Panic(uint256)`), which honours the ABI offset and
decodes UTF-8 correctly. Added a non-ASCII (`café ✓ 日本語`) round-trip test; the
pre-existing ASCII / known-panic-code characterization tests confirm the rest of
the behaviour is preserved. Malformed short data now safely returns null via the
existing try/catch instead of parsing garbage.
