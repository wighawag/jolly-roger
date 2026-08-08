// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {SignatureUtils} from "src/core/utils/SignatureUtils.sol";
import {SignatureUtilsHarness} from "./SignatureUtilsHarness.sol";

contract SignatureUtilsTest is Test {
    SignatureUtilsHarness internal harness;

    uint256 internal signerKey = 0xA11CE;

    function setUp() public {
        harness = new SignatureUtilsHarness();
    }

    function _signer() internal view returns (address) {
        return vm.addr(signerKey);
    }

    // ==================== textDigest ====================

    /// @notice The EIP-191 prefix, including the DECIMAL length of the message.
    ///
    /// Pinned against a hand-built digest rather than against the library's own
    /// output, so an error in the length encoding cannot agree with itself.
    function test_textDigest_matchesTheEip191Construction() public view {
        bytes memory message = bytes("hello world");
        assertEq(
            harness.textDigest(message),
            keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n11", message)
            )
        );
    }

    /// @notice The length prefix crossing from one digit to two, and two to
    /// three. An off-by-one here changes the digest of every longer message.
    function test_textDigest_lengthPrefixAcrossDigitBoundaries() public view {
        bytes memory nine = bytes("123456789");
        assertEq(
            harness.textDigest(nine),
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n9", nine))
        );

        bytes memory ten = bytes("1234567890");
        assertEq(
            harness.textDigest(ten),
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n10", ten))
        );

        bytes memory hundred = new bytes(100);
        assertEq(
            harness.textDigest(hundred),
            keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n100", hundred)
            )
        );
    }

    function test_textDigest_emptyMessage() public view {
        assertEq(
            harness.textDigest(""),
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n0"))
        );
    }

    // ==================== recover ====================

    function test_recover_returnsTheSigner() public view {
        bytes32 digest = harness.textDigest(bytes("hello"));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        assertEq(harness.recover(digest, abi.encodePacked(r, s, v)), _signer());
    }

    function test_recover_rejectsAWrongLength() public {
        bytes32 digest = harness.textDigest(bytes("hello"));

        vm.expectRevert(SignatureUtils.MalformedSignature.selector);
        harness.recover(digest, hex"1234");
    }

    function test_recover_rejectsAnEmptySignature() public {
        bytes32 digest = harness.textDigest(bytes("hello"));

        vm.expectRevert(SignatureUtils.MalformedSignature.selector);
        harness.recover(digest, "");
    }

    /// @notice The malleability check, which is the one an ordinary test misses.
    ///
    /// The curve is symmetric: for any valid `(r, s, v)` there is a second
    /// `(r, n - s, v ^ 1)` recovering the SAME address. Accepting both turns one
    /// authorisation into two distinct valid signatures, which breaks anything
    /// identifying a signature by its bytes. Only the low half is accepted.
    function test_recover_rejectsTheFlippedHalfOfTheCurve() public {
        bytes32 digest = harness.textDigest(bytes("hello"));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

        // Sanity: the honest signature is in the low half and works.
        assertEq(harness.recover(digest, abi.encodePacked(r, s, v)), _signer());

        uint256 n =
            0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 flippedS = bytes32(n - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;

        vm.expectRevert(SignatureUtils.MalformedSignature.selector);
        harness.recover(digest, abi.encodePacked(r, flippedS, flippedV));
    }

    function test_recover_rejectsAnImpossibleV() public {
        bytes32 digest = harness.textDigest(bytes("hello"));
        (, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

        vm.expectRevert(SignatureUtils.MalformedSignature.selector);
        harness.recover(digest, abi.encodePacked(r, s, uint8(29)));
    }

    /// @notice `ecrecover` returns the zero address on failure instead of
    /// reverting, and zero compares equal to an empty mapping entry. Anything
    /// trusting the result unchecked would authorise on a garbage signature.
    function test_recover_neverReturnsTheZeroAddress() public {
        vm.expectRevert(SignatureUtils.UnrecoverableSignature.selector);
        harness.recover(
            bytes32(0),
            abi.encodePacked(bytes32(0), bytes32(0), uint8(27))
        );
    }

    function testFuzz_recover_roundTripsAnyMessage(
        uint256 key,
        bytes calldata message
    ) public view {
        key = bound(
            key,
            1,
            0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140
        );
        bytes32 digest = harness.textDigest(message);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);

        assertEq(
            harness.recover(digest, abi.encodePacked(r, s, v)),
            vm.addr(key)
        );
    }
}
