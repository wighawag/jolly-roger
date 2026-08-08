// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title Payments
/// @notice Sending value on to somebody else, from inside a call that was doing
/// something else anyway.
///
/// The pattern this exists for: an entry point takes a `payee` alongside its
/// real arguments and forwards whatever it was sent. It lets an app fund an
/// address that has to pay its own gas without a second transaction, which
/// matters most for an address that starts empty and therefore cannot send the
/// first thing it is meant to send. Worth putting on any entry point a funded
/// account calls, not only on registration, so the funding rides along with
/// whatever the user was already doing.
///
/// A library of `internal` functions, so it inlines into its callers and costs
/// nothing to deploy. It holds no state.
library Payments {
    /// @notice the recipient rejected the value, or ran out of gas taking it
    error TransferFailed(address payee);

    /// @notice value was sent with nowhere to forward it to
    error ValueWithNoPayee(uint256 amount);

    /// @notice forward `amount` to `payee`, if there is anything to forward.
    ///
    /// CALL THIS LAST, after the caller's own state is written. It hands control
    /// to `payee`, which may be a contract, and only an already-settled state is
    /// safe to be re-entered against.
    ///
    /// `call` with all the gas rather than `transfer` with its 2300 stipend: the
    /// stipend silently refuses any payee that is a smart account, which is an
    /// increasing share of them and none of the caller's business.
    ///
    /// Reverts rather than swallowing a failure. The point of forwarding is that
    /// the recipient ends up funded, so a transfer that vanished has not
    /// half-worked, it has failed, and the caller's own state change is
    /// worthless without it.
    ///
    /// A zero `amount` is a no-op, so a caller can pass one through
    /// unconditionally instead of guarding at every site. A zero `payee` is
    /// likewise fine WHEN there is nothing to forward, which is how an entry
    /// point says "no funding this time".
    ///
    /// But value with no payee REVERTS, rather than being quietly kept. The
    /// contract calling this has no reason to hold the money and typically no
    /// way to release it, so a no-op there would take a caller's mistake -
    /// value attached to a call that names no recipient - and turn it into
    /// funds nobody can ever recover. Failing the transaction leaves the money
    /// where it started.
    function forward(address payable payee, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        if (payee == address(0)) {
            revert ValueWithNoPayee(amount);
        }
        (bool success, ) = payee.call{value: amount}("");
        if (!success) {
            revert TransferFailed(payee);
        }
    }
}
