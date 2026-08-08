// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {StringUtils} from "./utils/StringUtils.sol";
import {SignatureUtils} from "./utils/SignatureUtils.sol";

/// @title Delegation
/// @notice Lets an account authorise one other address to act in its name.
///
/// The problem it solves: an app that acts on its user's behalf sends from a
/// key of its own, so the address that signs a transaction is not the account
/// the action belongs to. A contract that records `msg.sender` records the
/// wrong one, and the user sees one address in the app and another against
/// their actions, with nothing onchain connecting them.
///
/// A LIBRARY, NOT A BASE CONTRACT, and deliberately. Inheriting would give a
/// contract external functions that appear in its ABI without appearing in its
/// source, which is the opposite of what a contract you are about to deploy
/// should do, and it would stop an adopter declining a path it does not want.
/// As a library neither applies: you write your own entry points, and you can
/// see all of them.
///
/// The price is that you write those entry points, and they are lines that say
/// exactly what your contract exposes. If the standard shape is what you want,
/// {UsingDelegation} is that same set written once and ready to inherit - read
/// it for the full set - and inheriting it is safe for the same reason this is
/// a library at all, since the namespaced storage below means it declares no
/// state and so shifts none of yours. GreetingsRegistry takes that route.
///
/// STORAGE IS NAMESPACED (ERC-7201), so this owns a region nothing else can
/// collide with, at a slot derived from a name rather than from a position.
/// A contract already live behind a proxy can therefore adopt delegation on an
/// upgrade without disturbing the layout it already has.
///
/// Every function is `internal`, so they inline into your contract: no library
/// deployment, no linking, no `delegatecall`, and `msg.sender` is still the
/// caller you expect.
library Delegation {
    /// @notice emitted whenever an account's delegate changes, including when
    /// it is cleared (delegate is then the zero address)
    /// @param owner the account being represented
    /// @param delegate the address allowed to act for it
    event DelegateChanged(address indexed owner, address indexed delegate);

    /// @notice `sender` is not the delegate registered for `owner`
    error NotDelegate(address owner, address sender);

    /// @notice the owner withdrew its authorisation; only the owner itself can
    /// authorise again (see {revoke})
    error DelegationWithdrawn(address owner);

    /// @notice the signature was not produced by `owner`
    error InvalidSignature();

    /// @notice a delegate must be a real address; use {revoke} to clear
    error InvalidDelegate();

    /// @custom:storage-location erc7201:jolly-roger.storage.Delegation
    struct Layout {
        /// owner => the address allowed to act for it.
        ///
        /// Keyed by OWNER rather than by delegate, deliberately. The reverse
        /// mapping would let anyone claim someone else's delegate address
        /// (which is public the moment that delegate sends anything) and have
        /// that owner's actions attributed to the claimer. Keyed this way, the
        /// worst an attacker achieves is making their OWN account answer to an
        /// address they do not control, which harms nobody.
        mapping(address => address) delegateOf;
        /// owner => whether the owner has withdrawn its authorisation.
        ///
        /// The signature that registers a delegate carries no nonce and never
        /// expires, so without this flag anyone could present it again and undo
        /// a revocation. Set by {revoke}, cleared only by {register}, which the
        /// owner sends itself.
        mapping(address => bool) withdrawn;
    }

    /// keccak256(abi.encode(uint256(keccak256("jolly-roger.storage.Delegation")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_LOCATION =
        0xecba87faceb9106e2bc3a71cd6a64c9d5c00d6626df0acb7ca7cca95efcc3200;

    /// @dev this library's storage, inside the CALLING contract.
    ///
    /// Internal library functions are inlined rather than `delegatecall`ed, so
    /// the slot below resolves against the caller's own storage. That is what
    /// lets a library own state without having any.
    ///
    /// PRIVATE, so an adopting contract cannot reach past the functions below
    /// and write the mappings directly. `internal` would hand every adopter a
    /// route around the zero-delegate check, the withdrawal flag and the event,
    /// which is a wide hole to leave in something meant to be handed to people
    /// writing their own contracts. Nothing outside this library needs it.
    function layout() private pure returns (Layout storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }

    // ------------------------------------------------------------------------
    // READING
    // ------------------------------------------------------------------------

    /// @notice the address currently allowed to act for `owner`, or the zero
    /// address when there is none.
    function delegateOf(address owner) internal view returns (address) {
        return layout().delegateOf[owner];
    }

    /// @notice whether `owner` has withdrawn its authorisation, which blocks
    /// {registerViaSignature} until the owner authorises again itself.
    function isWithdrawn(address owner) internal view returns (bool) {
        return layout().withdrawn[owner];
    }

    /// @notice whether `sender` may act as `onBehalfOf`.
    ///
    /// Asks; does not enforce. For a view a UI can call before offering an
    /// action, and for a call site that wants to do something other than revert.
    /// Anyone may always act as themselves, and a zero `onBehalfOf` means
    /// exactly that.
    ///
    /// @param sender normally `msg.sender`, but see UsingDelegation for the
    ///        case where a contract resolves its effective sender differently
    /// @param onBehalfOf the account being claimed, or zero for none
    function canActFor(
        address sender,
        address onBehalfOf
    ) internal view returns (bool) {
        if (onBehalfOf == address(0) || onBehalfOf == sender) {
            return true;
        }
        return layout().delegateOf[onBehalfOf] == sender;
    }

    /// @notice the account this action belongs to, or revert.
    ///
    /// THE FUNCTION YOUR CONTRACT ACTUALLY USES. Call it wherever you would
    /// have taken `msg.sender` as the identity an action belongs to, and record
    /// what it returns. A zero `onBehalfOf` means "acting for myself", so an
    /// entry point can pass one through unconditionally and behave exactly as
    /// it did before delegation existed.
    ///
    /// NAMED FOR THE ENFORCEMENT, not just the lookup: it reverts on an
    /// unauthorised claim rather than falling back to the sender. Somebody
    /// trying to act as somebody else is not a request to act as themselves,
    /// and quietly recording it that way would store an action nobody asked
    /// for. Use {canActFor} when a question rather than a requirement is what
    /// you want.
    ///
    /// @param sender normally `msg.sender`, but see UsingDelegation for the
    ///        case where a contract resolves its effective sender differently
    /// @param onBehalfOf the account being claimed, or zero for none
    function requireAccountFor(
        address sender,
        address onBehalfOf
    ) internal view returns (address) {
        if (!canActFor(sender, onBehalfOf)) {
            revert NotDelegate(onBehalfOf, sender);
        }
        return onBehalfOf == address(0) ? sender : onBehalfOf;
    }

    // ------------------------------------------------------------------------
    // GRANTING
    // ------------------------------------------------------------------------

    /// @notice authorise `delegate` to act for `owner`, on `owner`'s own say-so.
    ///
    /// AUTHORISES NOTHING ITSELF: the adopting contract must already have
    /// established that `owner` is the one asking, normally by passing
    /// `msg.sender`. It also CLEARS a previous withdrawal, which is only sound
    /// BECAUSE the owner is acting directly - that is a fresh decision, not a
    /// signature presented again - so passing anything else here would let one
    /// account undo another's revocation.
    ///
    /// @param owner the account authorising, i.e. `msg.sender`
    /// @param delegate the address to authorise; use {revoke} to clear
    function register(address owner, address delegate) internal {
        if (delegate == address(0)) {
            revert InvalidDelegate();
        }
        Layout storage $ = layout();
        $.withdrawn[owner] = false;
        $.delegateOf[owner] = delegate;
        emit DelegateChanged(owner, delegate);
    }

    /// @notice authorise `delegate` to act for `owner`, proven by `owner`'s
    /// signature, whoever is sending the transaction.
    ///
    /// The point: an owner that can sign but cannot send, or that holds no
    /// funds, can still delegate. It signs, somebody else submits and pays.
    ///
    /// The signature carries no nonce and does not expire, on purpose. It
    /// grants a standing authorisation to one named address, so presenting it a
    /// second time only re-asserts what is already true, at the submitter's
    /// expense. The one thing repetition could undo is a revocation, which is
    /// why {revoke} raises a flag this refuses to cross.
    ///
    /// @param owner the account being represented
    /// @param origin the scope the authorisation was granted for. Part of the
    ///        signed text, so the owner could see what they were authorising;
    ///        this library does not interpret it.
    /// @param delegate the address to authorise
    /// @param signature `owner`'s signature over {message}
    function registerViaSignature(
        address owner,
        string calldata origin,
        address delegate,
        bytes calldata signature
    ) internal {
        if (delegate == address(0)) {
            revert InvalidDelegate();
        }
        Layout storage $ = layout();
        if ($.withdrawn[owner]) {
            revert DelegationWithdrawn(owner);
        }
        if (
            SignatureUtils.recover(digest(origin, delegate), signature) != owner
        ) {
            revert InvalidSignature();
        }

        $.delegateOf[owner] = delegate;
        emit DelegateChanged(owner, delegate);
    }

    /// @notice withdraw `owner`'s authorisation: its delegate can no longer
    /// act, and no signature can put it back.
    ///
    /// AUTHORISES NOTHING ITSELF: the adopting contract must already have
    /// established that `owner` is the one asking, normally by passing
    /// `msg.sender`.
    ///
    /// One-way as far as signatures are concerned, deliberately. Re-authorising
    /// takes a transaction from the owner ({register}), because a signature
    /// that carries no nonce can state a standing authorisation but cannot
    /// express a decision to reverse one, and reading it as such would let an
    /// old signature outrank a newer intent.
    ///
    /// This is withdrawal of consent, not key rotation. If a delegate key leaks
    /// there is nothing to rotate to that the same leak would not also expose,
    /// so the useful response is to stop.
    function revoke(address owner) internal {
        Layout storage $ = layout();
        $.withdrawn[owner] = true;
        $.delegateOf[owner] = address(0);
        emit DelegateChanged(owner, address(0));
    }

    // ------------------------------------------------------------------------
    // THE SIGNED TEXT
    // ------------------------------------------------------------------------

    // In three fixed pieces.
    //
    // Readable prose rather than typed data, because the owner is being asked
    // to hand another address authority over their account, and what they can
    // read in the signing dialog matters more than what it costs to check here.
    //
    // It names no chain and no contract. That is what lets the signature be
    // produced once, ahead of time, by something that does not yet know where
    // it will be used. The consequence, accepted knowingly: the same signature
    // is valid on every chain and in every contract honouring this scheme. That
    // matches what it says, which is "this address acts for me", a claim no
    // more or less true in one place than another. So the wording promises
    // nothing about what the delegate may do, which is for the adopting
    // contract to decide and to tell its users.
    //
    // WHATEVER PRODUCES THE SIGNATURE BUILDS THIS SAME STRING, so the wording
    // and the address casing are consensus, not style. Changing either
    // invalidates every signature ever generated, silently. In this repo the
    // counterpart is `originDelegationMessage` in @etherplay/connect-core, and
    // the two are pinned against each other in test/js/Delegation.test.ts.
    string internal constant MESSAGE_HEAD = "Origin: ";
    string internal constant MESSAGE_BODY =
        "\n\nIMPORTANT: Only sign on trusted websites.\n\nThis authorizes the following address to act on your behalf onchain:\n\n";
    string internal constant MESSAGE_TAIL =
        "\n\nApps at this origin can use it to send transactions in your name.";

    /// @notice the exact text an owner signs to authorise `delegate`.
    ///
    /// Expose it, so a caller can display it and so whatever produces the
    /// signature can be asserted byte-for-byte against it. The two have to
    /// agree exactly or every signature is rejected, so the agreement is worth
    /// being checkable from outside rather than by reading both sides.
    ///
    /// The address is rendered lowercase; see {StringUtils-toHexString}.
    function message(
        string calldata origin,
        address delegate
    ) internal pure returns (string memory) {
        return
            string(
                abi.encodePacked(
                    MESSAGE_HEAD,
                    origin,
                    MESSAGE_BODY,
                    StringUtils.toHexString(delegate),
                    MESSAGE_TAIL
                )
            );
    }

    /// @notice the EIP-191 digest of {message}.
    function digest(
        string calldata origin,
        address delegate
    ) internal pure returns (bytes32) {
        return SignatureUtils.textDigest(bytes(message(origin, delegate)));
    }
}
