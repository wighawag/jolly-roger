// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {StringUtils} from "./StringUtils.sol";

/// @title Signature Utils
/// @notice Recovering the address behind a signature, with the checks
/// `ecrecover` does not do for you.
///
/// A library of `internal` functions, so it inlines into its callers and costs
/// nothing to deploy. It holds no state.
library SignatureUtils {
    /// @notice the signature is not 65 bytes, or carries values no honest
    /// signer produces
    error MalformedSignature();

    /// @notice the signature is well-formed but recovers to nobody
    error UnrecoverableSignature();

    /// @notice the address that produced `signature` over `digest`.
    ///
    /// `ecrecover` alone is not enough, and each of the three checks here exists
    /// for a distinct reason:
    ///
    /// - A length other than 65 means the caller passed something that is not a
    ///   signature at all, and reading past it would recover an address from
    ///   whatever happened to be in memory.
    /// - The curve is symmetric, so `(r, s)` and `(r, -s)` both recover the same
    ///   address. Accepting either turns one authorisation into two distinct
    ///   valid signatures, which breaks anything that identifies a signature by
    ///   its bytes. Only the low half is accepted.
    /// - `ecrecover` returns the zero address on failure rather than reverting,
    ///   so an unchecked result compares equal to an uninitialised mapping entry
    ///   and quietly authorises the wrong thing.
    ///
    /// @param digest what was signed
    /// @param signature 65 bytes, `r || s || v`
    /// @return the recovered address, never the zero address
    function recover(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        if (signature.length != 65) {
            revert MalformedSignature();
        }

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // secp256k1n / 2
        if (
            uint256(s) >
            0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
        ) {
            revert MalformedSignature();
        }
        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            revert MalformedSignature();
        }

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) {
            revert UnrecoverableSignature();
        }
        return signer;
    }

    /// @notice the EIP-191 `personal_sign` digest of a text message.
    ///
    /// What a wallet actually signs when asked to sign a string: the text with
    /// a fixed prefix and its own byte length in front, so a signature over a
    /// message can never be replayed as a signature over a transaction.
    ///
    /// The length is decimal ASCII, which is why this needs {StringUtils}.
    ///
    /// @param message the exact bytes shown to the signer
    function textDigest(bytes memory message) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n",
                    StringUtils.toString(message.length),
                    message
                )
            );
    }
}
