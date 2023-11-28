// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console2} from "forge-std/Test.sol";
import {GreetingsRegistry} from "../../src/GreetingsRegistry.sol";

contract GreetingsRegistryTest is Test {
    GreetingsRegistry public registry;

    function setUp() public {
        registry = new GreetingsRegistry("");
    }

    function test_setMessage() public {
        registry.setMessage("hello", 0);
        assertEq(registry.lastGreetingOf(address(this)), "hello");
    }
}
