// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {IGreetingsRegistry} from "./IGreetingsRegistry.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {Proxied} from "@rocketh/proxy/solc_0_8/ERC1967/Proxied.sol";

/// @title Greetings Registry
/// @notice let user set a greeting
contract GreetingsRegistry is IGreetingsRegistry, Proxied {
    /// @notice emitted whenever a user updates their greeting
    /// @param user the account whose greeting was updated
    /// @param message the new greeting
    event MessageChanged(address indexed user, string message);

    /// @notice emitted whenever an account's delegate changes, including when it
    /// is cleared (delegate is then the zero address).
    /// @param owner the account being represented
    /// @param delegate the address allowed to greet on its behalf
    event DelegateChanged(address indexed owner, address indexed delegate);

    /// @notice happen when trying to set an invalid greeting
    /// @param message the greeting
    error InvalidMessage(string message);

    /// @notice the caller is not the delegate registered for that account
    error NotDelegate(address owner, address caller);

    /// @notice the account withdrew its consent; only the account itself can
    /// register again (see {revokeDelegate}).
    error DelegationWithdrawn(address owner);

    /// @notice the signature is malformed, or was not produced by `owner`
    error InvalidSignature();

    /// @notice a delegate must be a real address; use {revokeDelegate} to clear
    error InvalidDelegate();

    /// @notice the forwarded funding could not be delivered
    error TransferFailed(address payee);

    string internal _prefix;

    struct MessagePointer {
        uint256 previous;
        address account;
        string message;
        uint256 timestamp;
    }
    mapping(address => uint256) internal _accountToMessage;
    mapping(uint256 => MessagePointer) internal _messages;
    uint256 internal _lastMessage;

    /// @dev owner => the address allowed to greet on its behalf.
    ///
    /// Keyed by OWNER rather than by delegate, deliberately. The reverse
    /// mapping would let anyone claim someone else's delegate address (which is
    /// public the moment that delegate sends anything) and have that owner's
    /// greetings attributed to the claimer. Keyed this way, the worst an
    /// attacker achieves is making their OWN account answer to an address they
    /// do not control, which harms nobody.
    mapping(address => address) internal _delegateOf;

    /// @dev owner => whether the owner has withdrawn its authorisation.
    ///
    /// The signature that registers a delegate carries no nonce and never
    /// expires (see {registerDelegateViaSignature}), so without this flag anyone
    /// could present it again and undo a revocation. Set by {revokeDelegate},
    /// cleared only by {registerDelegate}, which the owner sends itself.
    mapping(address => bool) internal _delegationWithdrawn;

    // ------------------------------------------------------------------------
    // CONSTRUCTOR / INITIALIZER
    //  support both proxy and constructor initialization
    //  zero overhead for constructor
    // ------------------------------------------------------------------------
    constructor(string memory prefix) {
        _init(prefix);
    }

    function _init(string memory prefix) internal {
        _prefix = prefix;
    }

    function init(string memory prefix) external asProxyInitialiser {
        _init(prefix);
    }

    // ------------------------------------------------------------------------

    /// @notice the greeting for each account
    function messages(address account) external view returns (string memory) {
        return _messages[_accountToMessage[account]].message;
    }

    function getLastMessages(
        uint256 limit
    ) external view returns (Message[] memory messagesToReturn) {
        uint256 currentMessageId = _lastMessage;
        if (currentMessageId != 0 && limit > 0) {
            Message[] memory tmpMessages = new Message[](limit);
            uint256 numMessages = 0;
            while (currentMessageId != 0) {
                MessagePointer memory message = _messages[currentMessageId];
                if (message.account == address(0)) {
                    currentMessageId = 0;
                    break;
                }
                tmpMessages[numMessages] = Message({
                    account: message.account,
                    message: message.message,
                    timestamp: message.timestamp
                });
                numMessages++;
                if (numMessages == limit) {
                    break;
                }
                currentMessageId = message.previous;
            }
            messagesToReturn = new Message[](numMessages);
            for (uint256 i = 0; i < numMessages; i++) {
                messagesToReturn[i] = tmpMessages[i];
            }
        }
    }

    /// @notice called to set your own greeting
    /// @param message the new greeting
    function setMessage(string calldata message) external {
        _setMessage(msg.sender, message);
    }

    /// @notice called by a registered delegate to set an account's greeting.
    ///
    /// The greeting is attributed to `owner`, not to the caller, which is the
    /// whole point of delegating: otherwise the registry records whichever
    /// address happened to send the transaction, and that is not the identity
    /// the greeting belongs to.
    ///
    /// @param owner the account whose greeting is being set
    /// @param message the new greeting
    function setMessageFor(address owner, string calldata message) external {
        if (_delegateOf[owner] != msg.sender) {
            revert NotDelegate(owner, msg.sender);
        }
        _setMessage(owner, message);
    }

    function _setMessage(address user, string calldata message) internal {
        if (bytes(message).length == 0) {
            revert InvalidMessage(message);
        }
        string memory actualMessage = string(
            abi.encodePacked(_prefix, message)
        );

        uint256 messageId = _lastMessage + 1;

        uint256 previousMessageFromAccount = _accountToMessage[user];
        if (previousMessageFromAccount != 0) {
            // if the account already had a message
            // get its prior
            uint256 prior = _messages[previousMessageFromAccount].previous;
            if (prior != 0) {
                // Move prior message's data into the vacated slot and update its mapping
                address priorAccount = _messages[prior].account;
                _messages[previousMessageFromAccount] = _messages[prior];
                _accountToMessage[priorAccount] = previousMessageFromAccount;
                delete _messages[prior];
            } else {
                delete _messages[previousMessageFromAccount];
            }
        }

        _messages[messageId] = MessagePointer({
            previous: _lastMessage,
            account: user,
            message: actualMessage,
            timestamp: block.timestamp
        });
        _accountToMessage[user] = messageId;
        _lastMessage = messageId;
        emit MessageChanged(user, actualMessage);
    }

    // ------------------------------------------------------------------------
    // DELEGATION
    //
    // An owner may authorise one other address to greet in its name. Two ways of
    // granting it, differing only in who sends the transaction, and one way of
    // taking it back.
    // ------------------------------------------------------------------------

    /// @notice the address currently allowed to greet on `owner`'s behalf, or
    /// the zero address when there is none.
    function delegateOf(address owner) external view returns (address) {
        return _delegateOf[owner];
    }

    /// @notice whether `owner` has withdrawn consent, which blocks
    /// {registerDelegateViaSignature} until the account registers again itself.
    function delegationWithdrawn(address owner) external view returns (bool) {
        return _delegationWithdrawn[owner];
    }

    /// @notice register a delegate for the caller, and optionally fund it in
    /// the same transaction.
    ///
    /// The funding is why `payee` is here rather than left to a separate
    /// transfer: a newly authorised address may hold nothing, and an address
    /// that cannot pay for gas cannot do the thing it was just authorised to do.
    /// Doing both at once removes the state in between, where the delegate is
    /// registered but unable to act.
    ///
    /// `payee` is free rather than forced to `delegate` because this is the
    /// caller's own money and the caller may reasonably direct it elsewhere.
    /// The signature variant does force it: there the money comes from a third
    /// party, who has no business choosing a destination the owner never named.
    ///
    /// This also CLEARS a previous withdrawal, because the owner is sending it
    /// directly. That is a fresh decision, not a signature presented again.
    ///
    /// @param delegate the address to allow; use {revokeDelegate} to clear
    /// @param payee where to forward `msg.value`, or the zero address to skip
    function registerDelegate(
        address delegate,
        address payable payee
    ) external payable {
        if (delegate == address(0)) {
            revert InvalidDelegate();
        }
        _delegationWithdrawn[msg.sender] = false;
        _delegateOf[msg.sender] = delegate;
        emit DelegateChanged(msg.sender, delegate);

        _forward(payee);
    }

    /// @notice register a delegate on behalf of `owner`, proven by `owner`'s
    /// signature, and fund that delegate with whatever value is sent.
    ///
    /// Anyone may submit this, and the submitter pays the gas. That is the whole
    /// purpose: an owner that can sign but cannot send, or that holds no funds,
    /// can still delegate. It signs, somebody else submits.
    ///
    /// The signature carries no nonce and does not expire, on purpose. It grants
    /// a standing authorisation to one named address, so presenting it a second
    /// time only re-asserts what is already true, at the submitter's expense,
    /// with the forwarded value coming from the submitter rather than the owner.
    /// The one thing repetition could undo is a revocation, which is why
    /// {revokeDelegate} raises a flag this function refuses to cross.
    ///
    /// `msg.value` goes to the delegate and nowhere else, because the owner
    /// authorised a delegate, not a destination, and the payer is not the owner.
    ///
    /// @param owner the account being represented
    /// @param origin the scope the authorisation was granted for. Part of the
    ///        signed text, so the owner could see what they were authorising;
    ///        this contract does not interpret it.
    /// @param delegate the address to allow
    /// @param signature `owner`'s signature over {delegationMessage}
    function registerDelegateViaSignature(
        address owner,
        string calldata origin,
        address delegate,
        bytes calldata signature
    ) external payable {
        if (delegate == address(0)) {
            revert InvalidDelegate();
        }
        if (_delegationWithdrawn[owner]) {
            revert DelegationWithdrawn(owner);
        }
        if (_recover(delegationDigest(origin, delegate), signature) != owner) {
            revert InvalidSignature();
        }

        _delegateOf[owner] = delegate;
        emit DelegateChanged(owner, delegate);

        _forward(payable(delegate));
    }

    /// @notice withdraw the authorisation: the caller's delegate can no longer
    /// act, and no signature can put it back.
    ///
    /// One-way as far as signatures are concerned, deliberately. Re-authorising
    /// takes a transaction from the owner ({registerDelegate}), because a
    /// signature that carries no nonce can state a standing authorisation but
    /// cannot express a decision to reverse one, and any attempt to read it as
    /// such would let an old signature outrank a newer intent.
    function revokeDelegate() external {
        _delegationWithdrawn[msg.sender] = true;
        _delegateOf[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    // ------------------------------------------------------------------------
    // SIGNATURE VERIFICATION
    // ------------------------------------------------------------------------

    // The text an owner signs, in three fixed pieces.
    //
    // Readable prose rather than typed data, because the owner is being asked to
    // hand another address authority over their account, and what they can read
    // in the signing dialog matters more than what it costs to check here.
    //
    // It names no chain and no contract. That is what lets the signature be
    // produced once, ahead of time, by something that does not yet know where it
    // will be used. The consequence, accepted knowingly: the same signature is
    // valid on every chain and in every contract honouring this scheme. That
    // matches what it says, which is "this address acts for me", a claim no more
    // or less true in one place than another. So the wording promises nothing
    // about what the delegate may do: here it may only greet, but somewhere else
    // the same signature might grant more.
    string internal constant MESSAGE_HEAD = "Origin: ";
    string internal constant MESSAGE_BODY =
        "\n\nIMPORTANT: Only sign on trusted websites.\n\nThis authorizes the following address to act on your behalf onchain:\n\n";
    string internal constant MESSAGE_TAIL =
        "\n\nApps at this origin can use it to send transactions in your name.";

    /// @notice the exact text an owner signs to authorise `delegate`.
    ///
    /// Public so a caller can display it, and so whatever produces the signature
    /// can be asserted byte-for-byte against it. The two have to agree exactly
    /// or every signature is rejected, so the agreement is worth being checkable
    /// from outside rather than by reading both sides.
    ///
    /// The address is rendered as lowercase hex; see {StringUtils-toHexString}
    /// for why it is not checksummed.
    function delegationMessage(
        string calldata origin,
        address delegate
    ) public pure returns (string memory) {
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

    /// @notice the EIP-191 personal_sign digest of {delegationMessage}.
    ///
    /// Public so a caller can check a signature before paying to submit one, and
    /// so tests do not have to reimplement the prefixing.
    function delegationDigest(
        string calldata origin,
        address delegate
    ) public pure returns (bytes32) {
        bytes memory message = bytes(delegationMessage(origin, delegate));
        return
            keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n",
                    StringUtils.toString(message.length),
                    message
                )
            );
    }

    /// @dev ecrecover with the three checks ecrecover itself does not do:
    /// a well-formed length, a normalised `v`, and a low `s` (the curve is
    /// symmetric, so both halves recover, and accepting either would make one
    /// authorisation into two distinct valid signatures).
    function _recover(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        if (signature.length != 65) {
            revert InvalidSignature();
        }

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (
            uint256(s) >
            0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
        ) {
            revert InvalidSignature();
        }
        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            revert InvalidSignature();
        }

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) {
            revert InvalidSignature();
        }
        return signer;
    }

    /// @dev forward whatever was sent, if anything, to `payee`.
    ///
    /// Called LAST, after the delegation is already written, so a payee that
    /// happens to be a contract and re-enters finds the state settled and gains
    /// nothing. That ordering is what makes it safe to use `call` with all the
    /// gas rather than `transfer` with its 2300 stipend: the stipend would
    /// quietly refuse any payee that is a smart account, which is an increasing
    /// share of them and none of this contract's business.
    ///
    /// Reverts on failure rather than keeping the money. A registration whose
    /// funding silently vanished would leave the delegate unable to act, which
    /// is precisely the state the funding exists to avoid.
    function _forward(address payable payee) internal {
        if (payee != address(0) && msg.value != 0) {
            (bool success, ) = payee.call{value: msg.value}("");
            if (!success) {
                revert TransferFailed(payee);
            }
        }
    }
}
