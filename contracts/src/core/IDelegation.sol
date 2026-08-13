// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title IDelegation
/// @notice The delegation entry points as a type, for code that has to NAME
/// them rather than inherit them.
///
/// {UsingDelegation} already writes these functions, so a contract that
/// inherits it needs nothing from here. This exists for the cases where the
/// implementation is not the thing being described:
///
///  - A contract behind a ROUTER cannot say "these selectors are mine" by
///    inheriting an abstract contract: the router needs a list of selectors,
///    composed from interfaces, while the implementation lives elsewhere.
///    Without a shared declaration every router restates the same seven
///    signatures, and a restatement is a copy that can drift.
///  - A client, a script or a test that calls into a contract it does not
///    compile against - `IDelegation(target).delegateOf(owner)` - which is
///    also the shape the web client mirrors in `DELEGATION_ABI`
///    (web/src/lib/onchain/delegation.ts).
///
/// DO NOT WRITE `is IDelegation, UsingDelegation`. It does not compile without
/// restating all seven functions as `override`, which is exactly the
/// boilerplate {UsingDelegation} exists to spare an adopter. Inherit the
/// implementation alone and use this interface where a TYPE is wanted; the two
/// agreeing is covered by a test (test/solidity/core/IDelegation.t.sol), and
/// on a router the thing that actually breaks is a selector that does not
/// route - a missing route in the deploy script, or two routes claiming the
/// same selector - which no compiler check would have caught.
///
/// The whole external surface, in the order {UsingDelegation} declares it, so
/// the two can be read side by side.
interface IDelegation {
    /// @notice authorise `delegate` to act for you, and optionally fund it.
    function registerDelegate(
        address delegate,
        address payable payee
    ) external payable;

    /// @notice authorise `delegate` to act for `owner`, proven by `owner`'s
    /// signature, and fund that delegate with whatever value is sent.
    function registerDelegateViaSignature(
        address owner,
        string calldata origin,
        address delegate,
        bytes calldata signature
    ) external payable;

    /// @notice withdraw your authorisation; no signature can put it back.
    function revokeDelegate() external;

    /// @notice the address currently allowed to act for `owner`.
    function delegateOf(address owner) external view returns (address);

    /// @notice whether `owner` has withdrawn its authorisation for `delegate`.
    function delegationWithdrawn(
        address owner,
        address delegate
    ) external view returns (bool);

    /// @notice the exact text an owner signs to authorise `delegate`.
    function delegationMessage(
        string calldata origin,
        address delegate
    ) external pure returns (string memory);

    /// @notice the EIP-191 digest of {delegationMessage}.
    function delegationDigest(
        string calldata origin,
        address delegate
    ) external pure returns (bytes32);
}
