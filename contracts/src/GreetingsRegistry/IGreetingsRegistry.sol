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

    // ------------------------------------------------------------------------
    // DELEGATION
    // ------------------------------------------------------------------------

    function delegateOf(address owner) external view returns (address);

    function delegationWithdrawn(address owner) external view returns (bool);

    function delegationMessage(
        string calldata origin,
        address delegate
    ) external pure returns (string memory);

    function delegationDigest(
        string calldata origin,
        address delegate
    ) external pure returns (bytes32);

    function registerDelegate(
        address delegate,
        address payable payee
    ) external payable;

    function registerDelegateViaSignature(
        address owner,
        string calldata origin,
        address delegate,
        bytes calldata signature
    ) external payable;

    function revokeDelegate() external;
}
