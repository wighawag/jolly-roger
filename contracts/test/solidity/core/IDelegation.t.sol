// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {IDelegation} from "src/core/IDelegation.sol";
import {UsingDelegation} from "src/core/UsingDelegation.sol";

/// A plain adopter, inheriting the implementation and NOT the interface.
///
/// That is the arrangement this file exists to check: a contract behind a
/// router declares {IDelegation} to compose its selector list while its
/// implementation only inherits {UsingDelegation}, so nothing makes the
/// compiler compare the two. See the note in IDelegation.sol about why
/// `is IDelegation, UsingDelegation` is not the answer.
contract PlainAdopter is UsingDelegation {}

/// @notice Every function {IDelegation} declares is answered by an adopter of
/// {UsingDelegation}.
///
/// The calls all go THROUGH the interface, so each one is dispatched on the
/// selector the interface computes. A signature that drifted on either side -
/// a renamed parameter type, a `view` that became `payable`, a function
/// declared here but never implemented - produces a different selector, the
/// adopter has no fallback, and the call below reverts.
contract IDelegationTest is Test {
    IDelegation internal adopter;

    string internal constant ORIGIN = "https://jolly-roger.example";

    uint256 internal ownerKey = 0xA11CE;
    address internal delegate = address(0xDE1E6A7E);
    address internal submitter = address(0xB0B);
    address internal stranger = address(0xC4A121E);

    function setUp() public {
        adopter = IDelegation(address(new PlainAdopter()));
    }

    function test_theReadsAreReachableThroughTheInterface() public view {
        assertEq(adopter.delegateOf(stranger), address(0));
        assertFalse(adopter.delegationWithdrawn(stranger, delegate));
    }

    function test_theMessageAndDigestAreReachableThroughTheInterface()
        public
        view
    {
        string memory message = adopter.delegationMessage(ORIGIN, delegate);
        assertEq(
            adopter.delegationDigest(ORIGIN, delegate),
            keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n",
                    vm.toString(bytes(message).length),
                    message
                )
            )
        );
    }

    function test_registerAndRevokeAreReachableThroughTheInterface() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        adopter.registerDelegate{value: 0.1 ether}(delegate, payable(delegate));
        assertEq(adopter.delegateOf(stranger), delegate);
        assertEq(delegate.balance, 0.1 ether);

        vm.prank(stranger);
        adopter.revokeDelegate();
        assertEq(adopter.delegateOf(stranger), address(0));
        assertTrue(adopter.delegationWithdrawn(stranger, delegate));
    }

    function test_registerViaSignatureIsReachableThroughTheInterface() public {
        address owner = vm.addr(ownerKey);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            ownerKey,
            adopter.delegationDigest(ORIGIN, delegate)
        );

        vm.deal(submitter, 1 ether);
        vm.prank(submitter);
        adopter.registerDelegateViaSignature{value: 0.2 ether}(
            owner,
            ORIGIN,
            delegate,
            abi.encodePacked(r, s, v)
        );

        assertEq(adopter.delegateOf(owner), delegate);
        assertEq(delegate.balance, 0.2 ether);
    }
}
