// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {IGreetingsRegistry} from "./IGreetingsRegistry.sol";
import {UsingDelegation} from "@etherplay/delegation/contracts/UsingDelegation.sol";
import {Proxied} from "@rocketh/proxy/solc_0_8/ERC1967/Proxied.sol";

/// @title Greetings Registry
/// @notice let user set a greeting
///
/// Inherits {UsingDelegation}, so a greeting can be sent by an address acting
/// for the greeter rather than by the greeter itself. That brings the standard
/// registration and revocation entry points with it; nothing here decides who
/// may act for whom, it only asks who a call belongs to and records the answer.
///
/// A contract wanting only some of those entry points, or different ones, uses
/// the library directly instead and writes its own. See the UsingDelegation.sol
/// that ships in the etherplay delegation package.
///
/// WHAT INHERITING IT GRANTS: a delegate authorised here may do anything at
/// THIS contract that its owner could do through {_requireAccountForSender} -
/// the whole contract, not one action - and nothing anywhere else, since the
/// address of this contract and the chain id are inside the message the owner
/// signs. That is why the library ships as SOURCE compiled into each adopter
/// and never as a shared registry deployment: a registry would put its own
/// address in every signature, making one credential good at every game on it.
contract GreetingsRegistry is IGreetingsRegistry, UsingDelegation, Proxied {
    /// @notice emitted whenever a user updates their greeting
    /// @param user the account whose greeting was updated
    /// @param message the new greeting
    event MessageChanged(address indexed user, string message);

    /// @notice happen when trying to set an invalid greeting
    /// @param message the greeting
    error InvalidMessage(string message);

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
    /// The greeting is attributed to `owner`, not to the sender, which is the
    /// whole point of delegating: otherwise the registry records whichever
    /// address happened to send the transaction, and that is not the identity
    /// the greeting belongs to.
    ///
    /// @param owner the account whose greeting is being set
    /// @param message the new greeting
    function setMessageFor(address owner, string calldata message) external {
        _setMessage(_requireAccountForSender(owner), message);
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
}
