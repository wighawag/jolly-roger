// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Delegation} from "src/core/Delegation.sol";
import {Payments} from "src/core/utils/Payments.sol";
import {SignatureUtils} from "src/core/utils/SignatureUtils.sol";

/// The smallest thing that USES {Delegation}: it declares the entry points a
/// real contract would, and asks who a call belongs to. Standing in for a real
/// contract keeps these tests about the mechanism rather than about whatever
/// the mechanism is used for.
///
/// That it has to declare them at all is the library's central trade-off, made
/// visible: nothing appears here that was not written here.
contract DelegationHarness {
    address public lastActor;

    function act(address onBehalfOf) external {
        lastActor = Delegation.requireAccountFor(msg.sender, onBehalfOf);
    }

    function canActFor(
        address caller,
        address onBehalfOf
    ) external view returns (bool) {
        return Delegation.canActFor(caller, onBehalfOf);
    }

    function registerDelegate(
        address delegate,
        address payable payee
    ) external payable {
        Delegation.register(msg.sender, delegate);
        Payments.forward(payee, msg.value);
    }

    function registerDelegateViaSignature(
        address owner,
        string calldata origin,
        address delegate,
        bytes calldata signature
    ) external payable {
        Delegation.registerViaSignature(owner, origin, delegate, signature);
        Payments.forward(payable(delegate), msg.value);
    }

    function revokeDelegate() external {
        Delegation.revoke(msg.sender);
    }

    function delegateOf(address owner) external view returns (address) {
        return Delegation.delegateOf(owner);
    }

    function delegationWithdrawn(address owner) external view returns (bool) {
        return Delegation.isWithdrawn(owner);
    }

    function delegationMessage(
        string calldata origin,
        address delegate
    ) external pure returns (string memory) {
        return Delegation.message(origin, delegate);
    }

    function delegationDigest(
        string calldata origin,
        address delegate
    ) external pure returns (bytes32) {
        return Delegation.digest(origin, delegate);
    }
}

/// Refuses to be paid, to exercise the failure branch of value forwarding.
contract RejectsValue {
    receive() external payable {
        revert("no thanks");
    }
}

contract DelegationTest is Test {
    DelegationHarness internal harness;

    string internal constant ORIGIN = "https://jolly-roger.example";

    // An owner as a KEY, because half of these need it to sign. It stands for
    // an account that can sign and can never send.
    uint256 internal ownerKey = 0xA11CE;
    address internal delegate = address(0xDE1E6A7E);
    address internal submitter = address(0xB0B);
    address internal stranger = address(0xC4A121E);
    address payable internal payee = payable(address(0xFEE));

    function setUp() public {
        harness = new DelegationHarness();
    }

    function _owner() internal view returns (address) {
        return vm.addr(ownerKey);
    }

    function _sign(
        uint256 key,
        address forDelegate
    ) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            key,
            harness.delegationDigest(ORIGIN, forDelegate)
        );
        return abi.encodePacked(r, s, v);
    }

    // ==================== requireAccountFor ====================

    function test_requireAccountFor_returnsTheCallerWhenNothingIsClaimed()
        public
    {
        vm.prank(stranger);
        harness.act(address(0));
        assertEq(harness.lastActor(), stranger);
    }

    function test_requireAccountFor_lettingTheCallerNameItself() public {
        // No authorisation needed to act as yourself, so a call site can pass
        // an owner through unconditionally without a delegation existing.
        vm.prank(stranger);
        harness.act(stranger);
        assertEq(harness.lastActor(), stranger);
    }

    function test_requireAccountFor_returnsTheOwnerForItsDelegate() public {
        address owner = _owner();
        vm.prank(owner);
        harness.registerDelegate(delegate, payable(address(0)));

        vm.prank(delegate);
        harness.act(owner);
        assertEq(harness.lastActor(), owner);
    }

    /// @notice Reverts rather than quietly falling back to the caller. An
    /// unauthorised claim is somebody trying to act as somebody else, and
    /// attributing it to them instead would record an action nobody asked for.
    function test_requireAccountFor_revertsOnAnUnauthorisedClaim() public {
        address owner = _owner();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.NotDelegate.selector,
                owner,
                stranger
            )
        );
        harness.act(owner);
    }

    // ==================== canActFor ====================
    //
    // The question {requireAccountFor} is the assertion of. Kept separate so a
    // caller that wants to offer or hide an action, rather than to fail one,
    // does not have to provoke a revert to find out.

    function test_canActFor_isTrueForYourself() public view {
        assertTrue(harness.canActFor(stranger, stranger));
        assertTrue(harness.canActFor(stranger, address(0)));
    }

    function test_canActFor_followsTheRegistration() public {
        address owner = _owner();
        assertFalse(harness.canActFor(delegate, owner));

        vm.prank(owner);
        harness.registerDelegate(delegate, payable(address(0)));
        assertTrue(harness.canActFor(delegate, owner));

        vm.prank(owner);
        harness.revokeDelegate();
        assertFalse(harness.canActFor(delegate, owner));
    }

    /// @notice It asks, it does not enforce: no revert for an answer of no.
    function test_canActFor_doesNotRevert() public view {
        assertFalse(harness.canActFor(stranger, _owner()));
    }

    // ==================== registerDelegate ====================

    function test_registerDelegate_setsAndReportsTheDelegate() public {
        vm.prank(stranger);
        harness.registerDelegate(delegate, payable(address(0)));
        assertEq(harness.delegateOf(stranger), delegate);
    }

    function test_registerDelegate_emits() public {
        vm.expectEmit(true, true, false, false);
        emit Delegation.DelegateChanged(stranger, delegate);
        vm.prank(stranger);
        harness.registerDelegate(delegate, payable(address(0)));
    }

    function test_registerDelegate_rejectsTheZeroDelegate() public {
        vm.prank(stranger);
        vm.expectRevert(Delegation.InvalidDelegate.selector);
        harness.registerDelegate(address(0), payable(address(0)));
    }

    function test_registerDelegate_forwardsValueToThePayee() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        harness.registerDelegate{value: 0.4 ether}(delegate, payee);

        assertEq(payee.balance, 0.4 ether);
        assertEq(address(harness).balance, 0);
    }

    /// @notice Value with no payee reverts rather than being kept.
    ///
    /// A zero payee is how an entry point says "no funding this time", so
    /// attaching value to one is a caller mistake. Keeping it would be the
    /// worst possible response: this contract has no way to release money, so
    /// the mistake would become funds nobody can ever recover. Failing leaves
    /// them where they started.
    function test_registerDelegate_refusesValueWithNoPayee() public {
        vm.deal(stranger, 1 ether);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Payments.ValueWithNoPayee.selector,
                uint256(1 ether)
            )
        );
        harness.registerDelegate{value: 1 ether}(delegate, payable(address(0)));

        // Nothing was kept, and nothing was registered: the whole call is off.
        assertEq(address(harness).balance, 0);
        assertEq(stranger.balance, 1 ether);
        assertEq(harness.delegateOf(stranger), address(0));
    }

    /// @notice A zero payee is still fine when there is nothing to forward,
    /// which is the ordinary "register without funding" case.
    function test_registerDelegate_allowsNoPayeeWhenNoValueIsSent() public {
        vm.prank(stranger);
        harness.registerDelegate(delegate, payable(address(0)));
        assertEq(harness.delegateOf(stranger), delegate);
    }

    function test_registerDelegate_forwardsNothingWhenNothingIsSent() public {
        vm.prank(stranger);
        harness.registerDelegate(delegate, payee);
        assertEq(payee.balance, 0);
    }

    function test_registerDelegate_revertsWhenThePayeeRefuses() public {
        address payable refuser = payable(address(new RejectsValue()));
        vm.deal(stranger, 1 ether);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Payments.TransferFailed.selector, refuser)
        );
        harness.registerDelegate{value: 1}(delegate, refuser);
    }

    // ==================== registerDelegateViaSignature ====================

    function test_viaSignature_registersAndIsPaidForBySomebodyElse() public {
        address owner = _owner();
        vm.deal(submitter, 1 ether);

        vm.prank(submitter);
        harness.registerDelegateViaSignature{value: 0.25 ether}(
            owner,
            ORIGIN,
            delegate,
            _sign(ownerKey, delegate)
        );

        assertEq(harness.delegateOf(owner), delegate);
        // The value goes to the delegate and nowhere else, and the owner never
        // held or spent anything.
        assertEq(delegate.balance, 0.25 ether);
        assertEq(owner.balance, 0);
    }

    function test_viaSignature_rejectsAnotherKeysSignature() public {
        // Signed and recovered BEFORE expectRevert is armed: it applies to the
        // next call, and building the signature makes calls of its own.
        address owner = _owner();
        bytes memory signature = _sign(0xB0B, delegate);

        vm.prank(submitter);
        vm.expectRevert(Delegation.InvalidSignature.selector);
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            delegate,
            signature
        );
    }

    function test_viaSignature_rejectsADifferentDelegate() public {
        // The delegate is the one thing the signature pins down.
        address owner = _owner();
        bytes memory signature = _sign(ownerKey, delegate);

        vm.prank(submitter);
        vm.expectRevert(Delegation.InvalidSignature.selector);
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            address(0xBAD),
            signature
        );
    }

    function test_viaSignature_rejectsADifferentOrigin() public {
        address owner = _owner();
        bytes memory signature = _sign(ownerKey, delegate);

        vm.prank(submitter);
        vm.expectRevert(Delegation.InvalidSignature.selector);
        harness.registerDelegateViaSignature(
            owner,
            "https://not-the-app.example",
            delegate,
            signature
        );
    }

    function test_viaSignature_rejectsAMalformedSignature() public {
        address owner = _owner();

        vm.prank(submitter);
        vm.expectRevert(SignatureUtils.MalformedSignature.selector);
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            delegate,
            hex"1234"
        );
    }

    /// @notice No nonce, so this succeeds - and that is the design, not an
    /// oversight. It re-asserts a standing authorisation at the submitter's
    /// expense and changes nothing.
    function test_viaSignature_presentingItAgainIsHarmless() public {
        address owner = _owner();
        bytes memory signature = _sign(ownerKey, delegate);

        vm.prank(submitter);
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            delegate,
            signature
        );
        vm.prank(stranger);
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            delegate,
            signature
        );

        assertEq(harness.delegateOf(owner), delegate);
    }

    // ==================== revokeDelegate ====================

    function test_revoke_clearsTheDelegate() public {
        vm.prank(stranger);
        harness.registerDelegate(delegate, payable(address(0)));

        vm.prank(stranger);
        harness.revokeDelegate();

        assertEq(harness.delegateOf(stranger), address(0));
        assertTrue(harness.delegationWithdrawn(stranger));
    }

    /// @notice The reason the withdrawal flag exists at all.
    ///
    /// The signature has no nonce and never expires, so without the flag anyone
    /// could present it again and quietly undo a revocation the owner meant.
    function test_revoke_cannotBeUndoneByPresentingTheSignatureAgain() public {
        address owner = _owner();
        bytes memory signature = _sign(ownerKey, delegate);

        vm.prank(submitter);
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            delegate,
            signature
        );

        vm.prank(owner);
        harness.revokeDelegate();

        vm.prank(submitter);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.DelegationWithdrawn.selector,
                owner
            )
        );
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            delegate,
            signature
        );

        assertEq(harness.delegateOf(owner), address(0));
    }

    /// @notice Withdrawal is one-way for signatures, but the OWNER can always
    /// change its mind: sending the transaction is live consent, not a static
    /// message presented again.
    function test_revoke_isClearedByTheOwnerRegisteringAgain() public {
        address owner = _owner();

        vm.prank(owner);
        harness.revokeDelegate();
        assertTrue(harness.delegationWithdrawn(owner));

        vm.prank(owner);
        harness.registerDelegate(delegate, payable(address(0)));
        assertFalse(harness.delegationWithdrawn(owner));

        // ...and signatures work again from here on.
        vm.prank(submitter);
        harness.registerDelegateViaSignature(
            owner,
            ORIGIN,
            delegate,
            _sign(ownerKey, delegate)
        );
        assertEq(harness.delegateOf(owner), delegate);
    }

    // ==================== keyed by owner ====================

    /// @notice One account cannot damage another by claiming its delegate.
    ///
    /// The mapping is keyed by OWNER precisely so this is a no-op against the
    /// victim: the claimer only makes their own account answer to an address
    /// they do not control.
    function test_claimingSomebodyElsesDelegateDoesNotAffectThem() public {
        address owner = _owner();

        vm.prank(owner);
        harness.registerDelegate(delegate, payable(address(0)));

        vm.prank(stranger);
        harness.registerDelegate(delegate, payable(address(0)));

        vm.prank(delegate);
        harness.act(owner);

        assertEq(harness.lastActor(), owner);
        assertEq(harness.delegateOf(owner), delegate);
    }

    // ==================== the signed text ====================

    /// @notice The exact bytes whatever produces the signature has to
    /// reproduce.
    ///
    /// Pinned as a literal rather than rebuilt, so changing the wording is a
    /// deliberate act with a failing test attached, instead of something that
    /// silently invalidates every signature ever generated.
    function test_delegationMessage_isExactlyThis() public view {
        assertEq(
            harness.delegationMessage(ORIGIN, delegate),
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

    function test_delegationMessage_carriesTheOrigin() public view {
        assertEq(
            harness.delegationMessage("https://other.example", delegate),
            string(
                abi.encodePacked(
                    "Origin: https://other.example\n\n",
                    "IMPORTANT: Only sign on trusted websites.\n\n",
                    "This authorizes the following address to act on your behalf onchain:\n\n",
                    "0x00000000000000000000000000000000de1e6a7e\n\n",
                    "Apps at this origin can use it to send transactions in your name."
                )
            )
        );
    }

    // ==================== storage layout ====================

    /// @notice Namespaced storage (ERC-7201) is what makes this safe to inherit.
    ///
    /// Storage of a base contract precedes that of the contract inheriting it,
    /// so plain state here would shift every slot of an adopting contract and
    /// corrupt anything already live behind a proxy. This asserts the delegate
    /// mapping really does live at the namespaced location and not at slot 0.
    function test_storageLivesAtTheNamespacedLocation() public {
        bytes32 location =
            keccak256(
                abi.encode(
                    uint256(keccak256("jolly-roger.storage.Delegation")) - 1
                )
            ) & ~bytes32(uint256(0xff));

        vm.prank(stranger);
        harness.registerDelegate(delegate, payable(address(0)));

        // delegateOf is the first member of the struct, so its mapping base is
        // the location itself.
        bytes32 slot = keccak256(abi.encode(stranger, location));
        assertEq(
            address(uint160(uint256(vm.load(address(harness), slot)))),
            delegate
        );

        // ...and nothing landed at slot 0, where an adopting contract's own
        // first variable has to stay.
        assertEq(vm.load(address(harness), bytes32(0)), bytes32(0));
    }
}
