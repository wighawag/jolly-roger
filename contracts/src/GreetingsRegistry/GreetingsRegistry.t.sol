// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {GreetingsRegistry} from "./GreetingsRegistry.sol";

contract GreetingsRegistryTest is Test {
    uint256 internal testNumber;
    GreetingsRegistry internal registry;

    address internal alice = address(0x1);
    address internal bob = address(0x2);
    address internal charlie = address(0x3);

    function setUp() public {
        registry = new GreetingsRegistry("");
    }

    function test_setMessageWorks() public {
        string memory message = registry.messages(address(this));
        assertEq(message, "");
        registry.setMessage("hello");
        string memory messageAfter = registry.messages(address(this));
        assertEq(messageAfter, "hello");
    }

    // ==================== getLastMessages Tests ====================

    function test_getLastMessages_emptyRegistry() public view {
        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );
        assertEq(messages.length, 0);
    }

    function test_getLastMessages_singleMessage() public {
        vm.prank(alice);
        registry.setMessage("hello from alice");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );
        assertEq(messages.length, 1);
        assertEq(messages[0].account, alice);
        assertEq(messages[0].message, "hello from alice");
    }

    function test_getLastMessages_multipleAccountsSingleMessage() public {
        vm.prank(alice);
        registry.setMessage("hello from alice");

        vm.prank(bob);
        registry.setMessage("hello from bob");

        vm.prank(charlie);
        registry.setMessage("hello from charlie");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );
        assertEq(messages.length, 3);
        // Messages should be in reverse order (most recent first)
        assertEq(messages[0].account, charlie);
        assertEq(messages[0].message, "hello from charlie");
        assertEq(messages[1].account, bob);
        assertEq(messages[1].message, "hello from bob");
        assertEq(messages[2].account, alice);
        assertEq(messages[2].message, "hello from alice");
    }

    function test_getLastMessages_limitLessThanTotal() public {
        vm.prank(alice);
        registry.setMessage("hello from alice");

        vm.prank(bob);
        registry.setMessage("hello from bob");

        vm.prank(charlie);
        registry.setMessage("hello from charlie");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            2
        );
        // The limit should cap the number of returned messages
        assertEq(messages.length, 2);
        // Should return the 2 most recent messages
        assertEq(messages[0].account, charlie);
        assertEq(messages[0].message, "hello from charlie");
        assertEq(messages[1].account, bob);
        assertEq(messages[1].message, "hello from bob");
    }

    // ==================== Account Sets Multiple Messages Tests ====================

    function test_accountSetsMultipleMessages_latestIsReturned() public {
        vm.prank(alice);
        registry.setMessage("first message");

        vm.prank(alice);
        registry.setMessage("second message");

        vm.prank(alice);
        registry.setMessage("third message");

        // Check that messages() returns the latest
        string memory latestMessage = registry.messages(alice);
        assertEq(latestMessage, "third message");
    }

    function test_accountSetsMultipleMessages_linkedListHasOnlyLatest() public {
        vm.prank(alice);
        registry.setMessage("first message");

        vm.prank(alice);
        registry.setMessage("second message");

        vm.prank(alice);
        registry.setMessage("third message");

        // The linked list should only have one entry for alice
        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );

        // Count messages from alice
        uint256 aliceCount = 0;
        for (uint256 i = 0; i < messages.length; i++) {
            if (messages[i].account == alice) {
                aliceCount++;
            }
        }
        assertEq(aliceCount, 1);
        // The message should be the latest
        bool foundLatest = false;
        for (uint256 i = 0; i < messages.length; i++) {
            if (messages[i].account == alice) {
                assertEq(messages[i].message, "third message");
                foundLatest = true;
            }
        }
        assertTrue(foundLatest);
    }

    function test_multipleAccountsSetMultipleMessages() public {
        // Alice sets 3 messages
        vm.prank(alice);
        registry.setMessage("alice msg 1");
        vm.prank(alice);
        registry.setMessage("alice msg 2");
        vm.prank(alice);
        registry.setMessage("alice msg 3");

        // Bob sets 2 messages
        vm.prank(bob);
        registry.setMessage("bob msg 1");
        vm.prank(bob);
        registry.setMessage("bob msg 2");

        // Charlie sets 1 message
        vm.prank(charlie);
        registry.setMessage("charlie msg 1");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );

        // Should have 3 unique messages (one per account)
        assertEq(messages.length, 3);

        // Verify each account appears only once with their latest message
        uint256 aliceCount = 0;
        uint256 bobCount = 0;
        uint256 charlieCount = 0;

        for (uint256 i = 0; i < messages.length; i++) {
            if (messages[i].account == alice) {
                aliceCount++;
                assertEq(messages[i].message, "alice msg 3");
            } else if (messages[i].account == bob) {
                bobCount++;
                assertEq(messages[i].message, "bob msg 2");
            } else if (messages[i].account == charlie) {
                charlieCount++;
                assertEq(messages[i].message, "charlie msg 1");
            }
        }

        assertEq(aliceCount, 1);
        assertEq(bobCount, 1);
        assertEq(charlieCount, 1);
    }

    function test_interleavedMessages_linkedListOrder() public {
        // Interleave messages from different accounts
        vm.prank(alice);
        registry.setMessage("alice first");

        vm.prank(bob);
        registry.setMessage("bob first");

        vm.prank(alice);
        registry.setMessage("alice second");

        vm.prank(charlie);
        registry.setMessage("charlie first");

        vm.prank(bob);
        registry.setMessage("bob second");

        vm.prank(alice);
        registry.setMessage("alice third");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );

        // Should have exactly 3 messages (one per account)
        assertEq(messages.length, 3);

        // Most recent is alice's third (added last)
        assertEq(messages[0].account, alice);
        assertEq(messages[0].message, "alice third");

        // Then bob's second
        assertEq(messages[1].account, bob);
        assertEq(messages[1].message, "bob second");

        // Then charlie's first
        assertEq(messages[2].account, charlie);
        assertEq(messages[2].message, "charlie first");
    }

    function test_accountUpdatesAfterOthers() public {
        // Set up initial state
        vm.prank(alice);
        registry.setMessage("alice initial");

        vm.prank(bob);
        registry.setMessage("bob initial");

        vm.prank(charlie);
        registry.setMessage("charlie initial");

        // Now alice updates
        vm.prank(alice);
        registry.setMessage("alice updated");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );

        // Alice should now be at the front of the list
        assertEq(messages[0].account, alice);
        assertEq(messages[0].message, "alice updated");
        assertEq(messages.length, 3);
    }

    function test_timestampIsRecorded() public {
        uint256 timestamp1 = 1000;
        vm.warp(timestamp1);
        vm.prank(alice);
        registry.setMessage("message at 1000");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );
        assertEq(messages[0].timestamp, timestamp1);

        uint256 timestamp2 = 2000;
        vm.warp(timestamp2);
        vm.prank(alice);
        registry.setMessage("message at 2000");

        messages = registry.getLastMessages(10);
        assertEq(messages[0].timestamp, timestamp2);
    }

    function test_manyUpdatesFromSingleAccount() public {
        // Test many sequential updates from same account
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(alice);
            registry.setMessage(
                string(abi.encodePacked("message ", vm.toString(i)))
            );
        }

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            20
        );

        // Should only have 1 message in the list
        assertEq(messages.length, 1);
        assertEq(messages[0].account, alice);
        assertEq(messages[0].message, "message 9");
    }

    /// @notice Test for the bug where shifting a message during update
    /// would leave orphaned entries causing duplicate accounts in getLastMessages.
    /// Scenario:
    /// 1. A sets message 1 (slot 1)
    /// 2. B sets message 2 (slot 2, prev: 1)
    /// 3. C sets message 3 (slot 3, prev: 2)
    /// 4. B sets message 4 - this shifts A's message from slot 1 to slot 2
    ///    BUG: _accountToMessage[A] was not updated, still points to deleted slot 1
    /// 5. A sets message 5 - since _accountToMessage[A] = 1 (deleted), A's message
    ///    at slot 2 is NOT removed, causing A to appear twice
    function test_shiftedMessageAccountMappingUpdated() public {
        // Step 1: A sets message
        vm.prank(alice);
        registry.setMessage("alice first");

        // Step 2: B sets message
        vm.prank(bob);
        registry.setMessage("bob first");

        // Step 3: C sets message
        vm.prank(charlie);
        registry.setMessage("charlie first");

        // Step 4: B updates - this should shift alice's message
        vm.prank(bob);
        registry.setMessage("bob second");

        // Step 5: A updates - this MUST remove A's shifted message
        vm.prank(alice);
        registry.setMessage("alice second");

        // Verify: each account should appear exactly once
        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );

        uint256 aliceCount = 0;
        uint256 bobCount = 0;
        uint256 charlieCount = 0;

        for (uint256 i = 0; i < messages.length; i++) {
            if (messages[i].account == alice) {
                aliceCount++;
                // Should be the latest message
                assertEq(messages[i].message, "alice second");
            } else if (messages[i].account == bob) {
                bobCount++;
                assertEq(messages[i].message, "bob second");
            } else if (messages[i].account == charlie) {
                charlieCount++;
                assertEq(messages[i].message, "charlie first");
            }
        }

        // CRITICAL: Each account must appear exactly once
        // Before the fix, alice would appear twice
        assertEq(aliceCount, 1, "Alice should appear exactly once");
        assertEq(bobCount, 1, "Bob should appear exactly once");
        assertEq(charlieCount, 1, "Charlie should appear exactly once");
        assertEq(messages.length, 3, "Should have exactly 3 messages");
    }

    function test_prefixIsApplied() public {
        GreetingsRegistry prefixedRegistry = new GreetingsRegistry("PREFIX: ");

        vm.prank(alice);
        prefixedRegistry.setMessage("hello");

        string memory message = prefixedRegistry.messages(alice);
        assertEq(message, "PREFIX: hello");

        GreetingsRegistry.Message[] memory messages = prefixedRegistry
            .getLastMessages(10);
        assertEq(messages[0].message, "PREFIX: hello");
    }

    // ==================== Delegation ====================

    string internal constant ORIGIN = "https://jolly-roger.example";

    // A key rather than a bare address, because half of these tests need the
    // OWNER to sign. `ownerKey` stands for an account authenticated by email or
    // social login: it can sign, and it can never send.
    uint256 internal ownerKey = 0xA11CE;
    address internal signer = address(0xDE1E6A7E);
    address payable internal payee = payable(address(0xFEE));

    function _owner() internal view returns (address) {
        return vm.addr(ownerKey);
    }

    function _sign(
        uint256 key,
        address delegate
    ) internal view returns (bytes memory) {
        bytes32 digest = registry.delegationDigest(ORIGIN, delegate);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---- registerDelegate (sent by the account itself) ----

    function test_registerDelegate_setsDelegate() public {
        vm.prank(alice);
        registry.registerDelegate(signer, payable(address(0)));

        assertEq(registry.delegateOf(alice), signer);
    }

    function test_registerDelegate_rejectsZeroDelegate() public {
        vm.prank(alice);
        vm.expectRevert(GreetingsRegistry.InvalidDelegate.selector);
        registry.registerDelegate(address(0), payable(address(0)));
    }

    function test_registerDelegate_forwardsValueToPayee() public {
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        registry.registerDelegate{value: 0.4 ether}(signer, payee);

        assertEq(payee.balance, 0.4 ether);
        assertEq(address(registry).balance, 0);
    }

    function test_registerDelegate_keepsNothingWhenNoValueSent() public {
        vm.prank(alice);
        registry.registerDelegate(signer, payee);

        assertEq(payee.balance, 0);
    }

    // ---- setMessageFor ----

    function test_setMessageFor_attributesToOwnerNotDelegate() public {
        vm.prank(alice);
        registry.registerDelegate(signer, payable(address(0)));

        vm.prank(signer);
        registry.setMessageFor(alice, "hello from the app");

        // The whole point: the greeting belongs to alice, and the key that
        // actually signed the transaction appears nowhere.
        assertEq(registry.messages(alice), "hello from the app");
        assertEq(registry.messages(signer), "");

        GreetingsRegistry.Message[] memory messages = registry.getLastMessages(
            10
        );
        assertEq(messages.length, 1);
        assertEq(messages[0].account, alice);
    }

    function test_setMessageFor_revertsForNonDelegate() public {
        vm.prank(alice);
        registry.registerDelegate(signer, payable(address(0)));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                GreetingsRegistry.NotDelegate.selector,
                alice,
                bob
            )
        );
        registry.setMessageFor(alice, "not mine to set");
    }

    function test_setMessageFor_revertsWhenNothingRegistered() public {
        vm.prank(signer);
        vm.expectRevert(
            abi.encodeWithSelector(
                GreetingsRegistry.NotDelegate.selector,
                alice,
                signer
            )
        );
        registry.setMessageFor(alice, "not mine to set");
    }

    function test_setMessage_isUnaffectedByDelegation() public {
        vm.prank(alice);
        registry.registerDelegate(signer, payable(address(0)));

        // The plain entry point still writes for whoever called it, which is
        // what keeps a deployment that never delegates behaving exactly as
        // before.
        vm.prank(alice);
        registry.setMessage("set by alice herself");
        assertEq(registry.messages(alice), "set by alice herself");

        vm.prank(signer);
        registry.setMessage("set by the signer, as itself");
        assertEq(registry.messages(signer), "set by the signer, as itself");
    }

    // ---- registerDelegateViaSignature ----

    function test_registerViaSignature_worksAndIsPaidForBySubmitter() public {
        address owner = _owner();
        bytes memory signature = _sign(ownerKey, signer);

        // bob is the payer: he submits, he pays the gas, he supplies the funds.
        // The owner holds nothing and sends nothing, which is the entire reason
        // this entry point exists.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        registry.registerDelegateViaSignature{value: 0.25 ether}(
            owner,
            ORIGIN,
            signer,
            signature
        );

        assertEq(registry.delegateOf(owner), signer);
        assertEq(signer.balance, 0.25 ether);
        assertEq(owner.balance, 0);
    }

    function test_registerViaSignature_letsDelegateGreetAsOwner() public {
        address owner = _owner();

        vm.prank(bob);
        registry.registerDelegateViaSignature(
            owner,
            ORIGIN,
            signer,
            _sign(ownerKey, signer)
        );

        vm.prank(signer);
        registry.setMessageFor(owner, "greetings");
        assertEq(registry.messages(owner), "greetings");
    }

    function test_registerViaSignature_rejectsAnotherKeysSignature() public {
        uint256 wrongKey = 0xB0B;
        bytes memory signature = _sign(wrongKey, signer);

        vm.prank(bob);
        vm.expectRevert(GreetingsRegistry.InvalidSignature.selector);
        registry.registerDelegateViaSignature(
            _owner(),
            ORIGIN,
            signer,
            signature
        );
    }

    function test_registerViaSignature_rejectsADifferentDelegate() public {
        // Signed for `signer`, submitted for someone else. The delegate is the
        // one thing the signature actually pins down, so this must not pass.
        bytes memory signature = _sign(ownerKey, signer);

        vm.prank(bob);
        vm.expectRevert(GreetingsRegistry.InvalidSignature.selector);
        registry.registerDelegateViaSignature(
            _owner(),
            ORIGIN,
            address(0xBAD),
            signature
        );
    }

    function test_registerViaSignature_rejectsADifferentOrigin() public {
        bytes memory signature = _sign(ownerKey, signer);

        vm.prank(bob);
        vm.expectRevert(GreetingsRegistry.InvalidSignature.selector);
        registry.registerDelegateViaSignature(
            _owner(),
            "https://not-the-app.example",
            signer,
            signature
        );
    }

    function test_registerViaSignature_rejectsMalformedSignature() public {
        vm.prank(bob);
        vm.expectRevert(GreetingsRegistry.InvalidSignature.selector);
        registry.registerDelegateViaSignature(
            _owner(),
            ORIGIN,
            signer,
            hex"1234"
        );
    }

    function test_registerViaSignature_replayIsHarmlessBeforeRevocation()
        public
    {
        address owner = _owner();
        bytes memory signature = _sign(ownerKey, signer);

        vm.prank(bob);
        registry.registerDelegateViaSignature(owner, ORIGIN, signer, signature);

        // No nonce, so this succeeds - and that is fine, because it re-asserts
        // the same fact at the replayer's expense.
        vm.prank(charlie);
        registry.registerDelegateViaSignature(owner, ORIGIN, signer, signature);

        assertEq(registry.delegateOf(owner), signer);
    }

    // ---- revokeDelegate ----

    function test_revoke_stopsTheDelegate() public {
        vm.prank(alice);
        registry.registerDelegate(signer, payable(address(0)));

        vm.prank(alice);
        registry.revokeDelegate();

        assertEq(registry.delegateOf(alice), address(0));
        assertTrue(registry.delegationWithdrawn(alice));

        vm.prank(signer);
        vm.expectRevert(
            abi.encodeWithSelector(
                GreetingsRegistry.NotDelegate.selector,
                alice,
                signer
            )
        );
        registry.setMessageFor(alice, "should not land");
    }

    /// @notice The reason `_delegationWithdrawn` exists at all.
    ///
    /// The registration signature has no nonce and never expires, so without the
    /// flag anyone could replay it and quietly undo a revocation the user
    /// deliberately made.
    function test_revoke_cannotBeUndoneByReplayingTheSignature() public {
        address owner = _owner();
        bytes memory signature = _sign(ownerKey, signer);

        vm.prank(bob);
        registry.registerDelegateViaSignature(owner, ORIGIN, signer, signature);

        vm.prank(owner);
        registry.revokeDelegate();

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                GreetingsRegistry.DelegationWithdrawn.selector,
                owner
            )
        );
        registry.registerDelegateViaSignature(owner, ORIGIN, signer, signature);

        assertEq(registry.delegateOf(owner), address(0));
    }

    /// @notice Withdrawal is one-way for signatures, but the ACCOUNT can always
    /// change its mind, because sending the transaction itself is live consent
    /// rather than a replayed static message.
    function test_revoke_isClearedByTheAccountRegisteringAgain() public {
        address owner = _owner();

        vm.prank(owner);
        registry.revokeDelegate();
        assertTrue(registry.delegationWithdrawn(owner));

        vm.prank(owner);
        registry.registerDelegate(signer, payable(address(0)));

        assertFalse(registry.delegationWithdrawn(owner));
        assertEq(registry.delegateOf(owner), signer);

        // ...and the signature works again from here on.
        vm.prank(bob);
        registry.registerDelegateViaSignature(
            owner,
            ORIGIN,
            signer,
            _sign(ownerKey, signer)
        );
        assertEq(registry.delegateOf(owner), signer);
    }

    /// @notice One account cannot damage another by claiming its delegate.
    ///
    /// The mapping is keyed by OWNER precisely so that this is a no-op against
    /// the victim: bob registering alice's signer only makes bob's own account
    /// controllable by a key bob does not hold.
    function test_claimingSomeoneElsesDelegateDoesNotAffectThem() public {
        vm.prank(alice);
        registry.registerDelegate(signer, payable(address(0)));

        vm.prank(bob);
        registry.registerDelegate(signer, payable(address(0)));

        vm.prank(signer);
        registry.setMessageFor(alice, "still alice");

        assertEq(registry.delegateOf(alice), signer);
        assertEq(registry.messages(alice), "still alice");
    }

    // ---- message encoding ----

    /// @notice The exact bytes the signing library has to reproduce.
    ///
    /// Pinned as a literal rather than rebuilt, so that changing the wording is
    /// a deliberate act with a failing test attached, instead of something that
    /// silently invalidates every signature ever generated.
    function test_delegationMessage_isExactlyThis() public view {
        string memory expected = string(
            abi.encodePacked(
                "Origin: https://jolly-roger.example\n\n",
                "IMPORTANT: Only sign on trusted websites.\n\n",
                "This authorizes the following address to act on your behalf onchain:\n\n",
                "0x00000000000000000000000000000000de1e6a7e\n\n",
                "Apps at this origin can use it to send transactions in your name."
            )
        );
        assertEq(registry.delegationMessage(ORIGIN, signer), expected);
    }

    /// @notice The address is rendered lowercase, never checksummed. Whatever
    /// produces the signature has to spell it the same way or nothing verifies.
    function test_delegationMessage_lowercasesTheAddress() public view {
        // Deliberately a mixed-case literal, to prove the case is not carried
        // through from however the address was written.
        address vector = 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed;
        string memory expected = string(
            abi.encodePacked(
                "Origin: ",
                ORIGIN,
                "\n\nIMPORTANT: Only sign on trusted websites.\n\n",
                "This authorizes the following address to act on your behalf onchain:\n\n",
                "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
                "\n\nApps at this origin can use it to send transactions in your name."
            )
        );
        assertEq(registry.delegationMessage(ORIGIN, vector), expected);
    }
}
