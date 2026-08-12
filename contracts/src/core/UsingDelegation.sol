// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {Delegation} from "./Delegation.sol";
import {Payments} from "./utils/Payments.sol";

/// @title Using Delegation
/// @notice The standard delegation entry points, ready to inherit.
///
/// {Delegation} is a library, so a contract adopting it writes its own external
/// functions. That is the right default: it keeps a contract's ABI and its
/// source in agreement, and lets it expose only what it means to. But it is
/// about seventy lines that are the same in every adopter, and getting them
/// wrong is not hypothetical - omit {revokeDelegate} and users are left unable
/// to withdraw an authorisation they have already given.
///
/// So this is the same set, written once. Inherit it when the standard shape is
/// what you want, and use the library directly when it is not.
///
/// SAFE TO INHERIT, and specifically because {Delegation} keeps its state in a
/// namespaced region (ERC-7201) rather than in state variables. This contract
/// declares NO storage of its own, so it adds nothing to your layout and shifts
/// nothing you already have. The usual reason to be wary of a base contract -
/// that its storage silently precedes yours - does not apply, and there is a
/// test asserting exactly that. Keep it that way: adding a state variable here
/// would break every contract that already inherits this.
///
/// Everything is `virtual`, so an adopter can wrap one to add access control,
/// pin the payee, or refuse a path it does not want.
///
/// There are three ways to resolve WHO is acting, in increasing order of
/// effort, and you want the first that fits:
///
///  1. Inherit this and call {_requireAccountForSender}. The sender is
///     `msg.sender`, which is right for a contract users call directly.
///  2. Inherit this and override {_requireAccountForSender}, for relayed or
///     signature-based execution where the sender is recovered rather than
///     observed. One override, every call site follows.
///  3. Skip this contract and call {Delegation} directly, passing whatever
///     address you like. The library never reads `msg.sender`.
abstract contract UsingDelegation {
    /// @notice authorise `delegate` to act for you, and optionally fund it.
    ///
    /// The funding is why `payee` is here rather than left to a separate
    /// transfer: a newly authorised address may hold nothing, and an address
    /// that cannot pay for gas cannot do the thing it was just authorised to
    /// do. Doing both at once removes the state in between.
    ///
    /// `payee` is free rather than forced to `delegate` because this is your
    /// own money and you may reasonably direct it elsewhere. The signature
    /// variant does force it: there the money comes from a third party, who has
    /// no business choosing a destination you never named.
    function registerDelegate(
        address delegate,
        address payable payee
    ) external payable virtual {
        Delegation.register(msg.sender, delegate);
        Payments.forward(payee, msg.value);
    }

    /// @notice authorise `delegate` to act for `owner`, proven by `owner`'s
    /// signature, and fund that delegate with whatever value is sent.
    ///
    /// Anyone may submit this and the submitter pays, which is the point: an
    /// owner that can sign but cannot send can still delegate.
    function registerDelegateViaSignature(
        address owner,
        string calldata origin,
        address delegate,
        bytes calldata signature
    ) external payable virtual {
        Delegation.registerViaSignature(owner, origin, delegate, signature);
        Payments.forward(payable(delegate), msg.value);
    }

    /// @notice withdraw your authorisation; no signature can put it back.
    ///
    /// DO NOT DROP THIS ONE if you override the set. An authorisation that
    /// cannot be withdrawn is the failure this whole mechanism has to avoid.
    function revokeDelegate() external virtual {
        Delegation.revoke(msg.sender);
    }

    /// @notice the address currently allowed to act for `owner`.
    function delegateOf(address owner) external view virtual returns (address) {
        return Delegation.delegateOf(owner);
    }

    /// @notice whether `owner` has withdrawn its authorisation for `delegate`.
    function delegationWithdrawn(
        address owner,
        address delegate
    ) external view virtual returns (bool) {
        return Delegation.isWithdrawn(owner, delegate);
    }

    /// @notice the exact text an owner signs to authorise `delegate`.
    function delegationMessage(
        string calldata origin,
        address delegate
    ) external pure virtual returns (string memory) {
        return Delegation.message(origin, delegate);
    }

    /// @notice the EIP-191 digest of {delegationMessage}.
    function delegationDigest(
        string calldata origin,
        address delegate
    ) external pure virtual returns (bytes32) {
        return Delegation.digest(origin, delegate);
    }

    /// @notice the account this call belongs to, or revert.
    ///
    /// THE FUNCTION YOUR OWN CODE USES. Call it wherever you would have taken
    /// `msg.sender` as the identity an action belongs to, and record what it
    /// returns. Zero means "acting for myself", so an entry point can pass one
    /// through unconditionally.
    ///
    /// It ENFORCES rather than looks up, reverting on an unauthorised claim
    /// instead of falling back; and it resolves against the SENDER, which this
    /// contract binds to `msg.sender` while {Delegation} leaves it a parameter.
    ///
    /// OVERRIDE THIS for relayed or signature-based execution, where the
    /// address that sent the transaction is not the address whose authority is
    /// being used:
    ///
    ///     function _requireAccountForSender(address onBehalfOf)
    ///         internal view override returns (address)
    ///     {
    ///         return Delegation.requireAccountFor(_recoveredSender(), onBehalfOf);
    ///     }
    ///
    /// See {Delegation-requireAccountFor} for the substance, and
    /// {Delegation-canActFor} for the question rather than the requirement.
    function _requireAccountForSender(
        address onBehalfOf
    ) internal view virtual returns (address) {
        return Delegation.requireAccountFor(msg.sender, onBehalfOf);
    }
}
