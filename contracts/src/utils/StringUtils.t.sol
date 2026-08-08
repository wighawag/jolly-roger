// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {StringUtils} from "./StringUtils.sol";

contract StringUtilsTest is Test {
    // ==================== toHexString ====================

    function test_toHexString_zeroAddress() public pure {
        assertEq(
            StringUtils.toHexString(address(0)),
            "0x0000000000000000000000000000000000000000"
        );
    }

    function test_toHexString_allBitsSet() public pure {
        assertEq(
            StringUtils.toHexString(
                address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF)
            ),
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
    }

    /// @notice Written mixed-case in the source, rendered lowercase. Solidity
    /// requires address literals to be checksummed, so this doubles as proof the
    /// case is produced here rather than carried through from the literal.
    function test_toHexString_lowercasesAChecksummedLiteral() public pure {
        assertEq(
            StringUtils.toHexString(0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed),
            "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"
        );
    }

    function test_toHexString_isAlways42Characters() public pure {
        assertEq(bytes(StringUtils.toHexString(address(0))).length, 42);
        assertEq(bytes(StringUtils.toHexString(address(1))).length, 42);
    }

    /// @notice Round-trips through `vm.parseAddress`, which is an independent
    /// implementation, so this checks the rendering against something other than
    /// a hand-written literal.
    function testFuzz_toHexString_roundTrips(address value) public pure {
        assertEq(vm.parseAddress(StringUtils.toHexString(value)), value);
    }

    // ==================== toString ====================

    function test_toString_zero() public pure {
        assertEq(StringUtils.toString(0), "0");
    }

    function test_toString_singleDigit() public pure {
        assertEq(StringUtils.toString(7), "7");
    }

    /// @notice The boundary that matters for the EIP-191 length prefix: a
    /// message whose length crosses from two digits to three must not gain a
    /// leading zero or lose a digit, or every signature over it fails to verify.
    function test_toString_digitBoundaries() public pure {
        assertEq(StringUtils.toString(9), "9");
        assertEq(StringUtils.toString(10), "10");
        assertEq(StringUtils.toString(99), "99");
        assertEq(StringUtils.toString(100), "100");
        assertEq(StringUtils.toString(255), "255");
    }

    function test_toString_max() public pure {
        assertEq(
            StringUtils.toString(type(uint256).max),
            "115792089237316195423570985008687907853269984665640564039457584007913129639935"
        );
    }

    function testFuzz_toString_roundTrips(uint256 value) public pure {
        assertEq(vm.parseUint(StringUtils.toString(value)), value);
    }
}
