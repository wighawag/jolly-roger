// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

interface IGreetingsRegistry {
    struct Message {
        address account;
        string message;
        uint256 timestamp;
    }

    function messages(address account) external view returns (string memory);

    function setMessage(string calldata message) external;

    function setMessageFor(address owner, string calldata message) external;

    function getLastMessages(
        uint256 limit
    ) external view returns (Message[] memory);
}

// Delegation is deliberately NOT declared here. It is a capability the registry
// gains by inheriting core/UsingDelegation, not part of what a greetings
// registry is, and a contract could implement this interface without it.
