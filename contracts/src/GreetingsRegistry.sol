// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-deploy-proxy/ForgeDeploy_Proxied.sol";

/// @notice a registry that let user send greetings to the world
///  It is used as a demo for jolly-roger,
///  a fully featured SDK to build entirely decentralised apps and games
///  It is inteded to be deployed via upgradeable proxy locally
///  to showcase the HCR (Hot Contract Replacement) capabilities of `hardhat-deploy`
///  but immutable on live networks.
contract GreetingsRegistry is Proxied {
    // ----------------------------------------------------------------------------------------------
    // EVENTS
    // ----------------------------------------------------------------------------------------------
    /// @notice emitted whenever a user set a new greeting to the world
    /// @param user the user that send the message
    /// @param timestamp the time at which the message was recorded
    /// @param message the message content
    /// @param dayTimeInSeconds the time of the day in seconds where 00:00 => 0 and 23:59 => 82859
    /// @dev the timestamp is included to speedup indexing
    /// see: https://ethereum-magicians.org/t/proposal-for-adding-blocktimestamp-to-logs-object-returned-by-eth-getlogs-and-related-requests/11183
    event MessageChanged(address indexed user, uint256 timestamp, string message, uint24 dayTimeInSeconds);

    // ----------------------------------------------------------------------------------------------
    // TYPES
    // ----------------------------------------------------------------------------------------------
    struct Message {
        string content;
        uint256 timestamp;
        uint24 dayTimeInSeconds;
    }

    // ----------------------------------------------------------------------------------------------
    // STORAGE
    // ----------------------------------------------------------------------------------------------
    mapping(address => Message) internal _messages;
    string internal _prefix;

    // ----------------------------------------------------------------------------------------------
    // CONSTRUCTOR / INITIALIZER
    // ----------------------------------------------------------------------------------------------

    /// @dev constructors
    /// @param initialPrefix the prefix that will be prepended to every user message goig forward
    constructor(string memory initialPrefix) {
        // the proxied modifier from `hardhat-deploy` (see `postUpgrade` function)
        //  ensure postUpgrade effect can only be used once when the contract is deployed without proxy.
        //  by calling that function in the constructor
        //  we ensure the contract behave the same whether it is deployed through a proxy or not.
        //  when the contract is deployed without proxy, the postUpgrade can never be called
        postUpgrade(initialPrefix);
    }

    //
    /// @dev called by the admin when the contract is deployed as a proxy
    /// @param initialPrefix the prefix that will be prepended to every user message goig forward
    function postUpgrade(string memory initialPrefix) public proxied {
        _prefix = initialPrefix;
    }

    // ----------------------------------------------------------------------------------------------
    // PUBLIC INTERFACE
    // ----------------------------------------------------------------------------------------------

    /// @notice return the last message from the given `user`.
    /// @param user address of the user.
    /// @return userMsg the message send by the user.
    function messages(address user) external view returns (Message memory userMsg) {
        userMsg = _messages[user];
    }

    /// @notice return the last greeting message from the given `user`.
    /// @param user address of the user.
    /// @return greeting the message's content send by the user.
    function lastGreetingOf(address user) external view returns (string memory greeting) {
        greeting = _messages[user].content;
    }

    /// @notice return the prefix that is appended to any new message.
    /// @return value prefix string.
    function prefix() external view returns (string memory value) {
        return _prefix;
    }

    /// @notice set a new message for `msg.sender`.
    /// @param message the value to set as content.
    /// @param dayTimeInSeconds the time of the day in seconds the message was written.
    function setMessage(string calldata message, uint24 dayTimeInSeconds) external {
        string memory actualMessage = string(bytes.concat(bytes(_prefix), bytes(message)));
        _messages[msg.sender] =
            Message({content: actualMessage, timestamp: block.timestamp, dayTimeInSeconds: dayTimeInSeconds});
        emit MessageChanged(msg.sender, block.timestamp, actualMessage, dayTimeInSeconds);
    }
}
