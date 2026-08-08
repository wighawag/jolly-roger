// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {SignatureUtils} from "src/core/utils/SignatureUtils.sol";

/// Exposes the library across the ABI boundary, for the TypeScript suite.
contract SignatureUtilsHarness {
    function recover(
        bytes32 digest,
        bytes calldata signature
    ) external pure returns (address) {
        return SignatureUtils.recover(digest, signature);
    }

    function textDigest(
        bytes calldata message
    ) external pure returns (bytes32) {
        return SignatureUtils.textDigest(message);
    }
}
