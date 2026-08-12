// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Delegation} from "src/core/Delegation.sol";
import {UsingDelegation} from "src/core/UsingDelegation.sol";

/// A contract that inherits the mixin AND has state of its own.
///
/// The state matters: `label` is declared here, in the DERIVED contract, which
/// is the position a base contract's storage would normally push out of slot 0.
/// If {UsingDelegation} ever gains a state variable, the assertion below stops
/// holding and this test fails, which is the point of it.
contract Adopter is UsingDelegation {
    string public label;
    uint256 public counter;

    address public lastActor;

    constructor(string memory initialLabel) {
        label = initialLabel;
    }

    function act(address onBehalfOf) external {
        lastActor = _requireAccountForSender(onBehalfOf);
        counter++;
    }
}

/// An adopter whose effective sender is NOT `msg.sender`.
///
/// Stands in for a relayed or signature-based contract, where the address that
/// sent the transaction is not the address whose authority is being used. It
/// overrides the one function {UsingDelegation} documents as the seam for
/// exactly this; a real one would recover the address from a signature rather
/// than being told it.
///
/// A TEST ARTIFACT, deliberately. Relayed execution is not something this repo
/// ships (it needs nonces and replay protection that delegation itself does
/// not), but the override IS documented as supported, and a `virtual` that
/// nothing exercises is a promise nobody has checked.
contract RelayedAdopter is UsingDelegation {
    address public effectiveSender;
    address public lastActor;

    function setEffectiveSender(address sender) external {
        effectiveSender = sender;
    }

    function _requireAccountForSender(
        address onBehalfOf
    ) internal view override returns (address) {
        return Delegation.requireAccountFor(effectiveSender, onBehalfOf);
    }

    function act(address onBehalfOf) external {
        lastActor = _requireAccountForSender(onBehalfOf);
    }
}

contract UsingDelegationTest is Test {
    Adopter internal adopter;

    string internal constant ORIGIN = "https://jolly-roger.example";

    uint256 internal ownerKey = 0xA11CE;
    address internal delegate = address(0xDE1E6A7E);
    address internal submitter = address(0xB0B);
    address internal stranger = address(0xC4A121E);

    function setUp() public {
        adopter = new Adopter("hello");
    }

    function _owner() internal view returns (address) {
        return vm.addr(ownerKey);
    }

    // ==================== the reason it is safe to inherit ====================

    /// @notice The mixin adds nothing to the adopter's storage layout.
    ///
    /// A base contract's state normally precedes the derived contract's, so
    /// inheriting one is inheriting a slot offset. {UsingDelegation} declares no
    /// state at all - {Delegation} keeps everything in a namespaced region - so
    /// the adopter's own first variable stays exactly where it would have been
    /// without the inheritance. That is what makes this mixin safe to add to a
    /// contract already live behind a proxy.
    function test_inheritingAddsNothingToTheLayout() public view {
        // `label` is a short string, so it lives inline in slot 0.
        bytes32 slot0 = vm.load(address(adopter), bytes32(0));
        assertEq(bytes5(slot0), bytes5(bytes("hello")));

        // and `counter` follows immediately in slot 1.
        assertEq(uint256(vm.load(address(adopter), bytes32(uint256(1)))), 0);
    }

    function test_delegationStateLivesInTheNamespacedRegion() public {
        bytes32 location =
            keccak256(
                abi.encode(
                    uint256(keccak256("jolly-roger.storage.Delegation")) - 1
                )
            ) & ~bytes32(uint256(0xff));
        assertEq(location, Delegation.STORAGE_LOCATION);

        vm.prank(stranger);
        adopter.registerDelegate(delegate, payable(address(0)));

        // delegateOf is the first struct member, so its mapping base is the
        // location itself.
        bytes32 slot = keccak256(abi.encode(stranger, location));
        assertEq(
            address(uint160(uint256(vm.load(address(adopter), slot)))),
            delegate
        );

        // The adopter's own state is untouched by any of it.
        assertEq(adopter.label(), "hello");
        assertEq(adopter.counter(), 0);
    }

    /// @notice Adopting delegation does not disturb what was already stored.
    function test_adoptersOwnStateSurvivesDelegationUse() public {
        vm.prank(stranger);
        adopter.act(address(0));
        assertEq(adopter.counter(), 1);

        address owner = _owner();
        vm.prank(owner);
        adopter.registerDelegate(delegate, payable(address(0)));

        vm.prank(delegate);
        adopter.act(owner);

        assertEq(adopter.lastActor(), owner);
        assertEq(adopter.counter(), 2);
        assertEq(adopter.label(), "hello");
    }

    // ==================== the entry points are wired ====================
    //
    // The mechanism itself is covered in Delegation.t.sol. What is checked here
    // is only that each inherited function reaches it, since a mixin that
    // forwards to the wrong thing would fail nowhere else.

    function test_registerAndRead() public {
        vm.prank(stranger);
        adopter.registerDelegate(delegate, payable(address(0)));

        assertEq(adopter.delegateOf(stranger), delegate);
        assertFalse(adopter.delegationWithdrawn(stranger, delegate));
    }

    function test_registerForwardsValue() public {
        address payable payee = payable(address(0xFEE));
        vm.deal(stranger, 1 ether);

        vm.prank(stranger);
        adopter.registerDelegate{value: 0.3 ether}(delegate, payee);

        assertEq(payee.balance, 0.3 ether);
    }

    function test_registerViaSignatureAndFundTheDelegate() public {
        address owner = _owner();
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

    function test_revoke() public {
        vm.prank(stranger);
        adopter.registerDelegate(delegate, payable(address(0)));

        vm.prank(stranger);
        adopter.revokeDelegate();

        assertEq(adopter.delegateOf(stranger), address(0));
        assertTrue(adopter.delegationWithdrawn(stranger, delegate));
    }

    function test_messageMatchesTheLibrary() public view {
        assertEq(
            adopter.delegationMessage(ORIGIN, delegate),
            string(
                abi.encodePacked(
                    "Origin: https://jolly-roger.example\n\n",
                    "IMPORTANT: Only sign on trusted websites.\n\n",
                    "This authorizes the following address to act on your behalf onchain:\n\n",
                    "0x00000000000000000000000000000000de1e6a7e\n\n",
                    "Apps at this origin can use it to send transactions in your name."
                )
            )
        );
    }

    // ==================== the override seam ====================
    //
    // The documented route to relayed or signature-based execution: override
    // one function and every call site in the contract follows it.

    function test_overridingTheSenderIsEnough() public {
        RelayedAdopter relayed = new RelayedAdopter();
        address owner = _owner();

        // Registration still reads msg.sender - only the ACTING path is
        // overridden, which is the common case and worth showing.
        vm.prank(owner);
        relayed.registerDelegate(delegate, payable(address(0)));

        // Now somebody else entirely sends the transaction, and the contract
        // still says the delegate is the one acting.
        relayed.setEffectiveSender(delegate);
        vm.prank(submitter);
        relayed.act(owner);

        assertEq(relayed.lastActor(), owner);
    }

    function test_overridingStillEnforces() public {
        RelayedAdopter relayed = new RelayedAdopter();
        address owner = _owner();

        // An effective sender that was never authorised is refused, even though
        // the transaction itself is perfectly well-formed.
        relayed.setEffectiveSender(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.NotDelegate.selector,
                owner,
                stranger
            )
        );
        relayed.act(owner);
    }

    /// @notice The override really does displace `msg.sender`, rather than this
    /// passing because the two happen to coincide.
    ///
    /// Without this one, the two above would pass even if the override did
    /// nothing at all.
    function test_overridingIgnoresTheRealMsgSender() public {
        RelayedAdopter relayed = new RelayedAdopter();
        address owner = _owner();

        vm.prank(owner);
        relayed.registerDelegate(delegate, payable(address(0)));

        // msg.sender IS the authorised delegate, but the effective sender is
        // not, so this must still fail.
        relayed.setEffectiveSender(stranger);
        vm.prank(delegate);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.NotDelegate.selector,
                owner,
                stranger
            )
        );
        relayed.act(owner);
    }

    function test_requireAccountForSenderRevertsOnAnUnauthorisedClaim() public {
        address owner = _owner();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.NotDelegate.selector,
                owner,
                stranger
            )
        );
        adopter.act(owner);
    }
}
