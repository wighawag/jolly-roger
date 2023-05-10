// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {GreetingsRegistry} from "src/GreetingsRegistry.sol";
import {Deployments} from "script/Deploy.s.sol";

contract GreetingsRegistryTest is Test {
    GreetingsRegistry public registry;

    function setUp() public {
        registry = new Deployments().deploy();
        registry.setMessage("hello", 1);
    }

    function testMessage() public {
        assertEq(registry.messages(address(this)).content, "hello");
    }

    function testSetMessage() public {
        registry.setMessage("hello2", 1);
        assertEq(registry.messages(address(this)).content, "hello2");
    }
}
