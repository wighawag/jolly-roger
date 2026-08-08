// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title String Utils
/// @notice Rendering values as text.
///
/// Needed wherever a contract has to reproduce a string that was built
/// somewhere else, which in practice means verifying a signature over
/// human-readable text: the signed bytes only match if both sides spell the
/// values the same way.
///
/// A library of `internal` functions, so it is inlined into its callers and
/// costs nothing to deploy. It holds no state and knows nothing about who uses
/// it.
library StringUtils {
    bytes internal constant HEX_DIGITS = "0123456789abcdef";

    /// @notice `0x`-prefixed, LOWERCASE hex form of an address.
    ///
    /// Lowercase rather than EIP-55 checksummed, deliberately. Checksumming
    /// costs a hash of the lowercase form plus a pass over every character, and
    /// settles nothing that matters: whoever produces a signature and whoever
    /// verifies it must agree on one spelling regardless, so the useful property
    /// is that the spelling is unambiguous and cheap, not that it carries a
    /// typo-detecting checksum nobody in this path is reading.
    ///
    /// @param value the address to render
    /// @return the 42-character lowercase representation
    function toHexString(address value) internal pure returns (string memory) {
        bytes20 raw = bytes20(value);
        bytes memory result = new bytes(42);
        result[0] = "0";
        result[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            result[2 + i * 2] = HEX_DIGITS[uint8(raw[i]) >> 4];
            result[3 + i * 2] = HEX_DIGITS[uint8(raw[i]) & 0x0f];
        }
        return string(result);
    }

    /// @notice decimal form of a number.
    ///
    /// @param value the number to render
    /// @return the shortest representation, with no leading zero except for
    ///         zero itself
    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 digits;
        for (uint256 rest = value; rest != 0; rest /= 10) {
            digits++;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
