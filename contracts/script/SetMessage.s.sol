// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {Deployer, getDeployer} from "forge-deploy/Deployer.sol";
import {GreetingsRegistry} from "src/GreetingsRegistry.sol";

contract SetMessageScript is Script {
    Deployer deployer;

    function setUp() public {
        deployer = getDeployer();
    }

    function run(string memory message) public {
        // Note that here we get the address without type-safety
        // There are 2 reasons for it
        // Once a contract is deployed, it is not anymore attached to the code present in the source folder
        // here we assume this is the case and cast it
        // Furthermore, we want our script to work on multiple chain
        // And while this is likely the same name contract will have the same interface, it is not necessarely always the case
        // After an upgrade, some network could be out of sync for a period
        // Having said all that, forge-deploy might add some generated code to deal with it in the future
        GreetingsRegistry registry = GreetingsRegistry(deployer.getAddress("Registry"));

        console.log(string.concat("previous message: ", registry.messages(address(this)).content));
        vm.broadcast();
        registry.setMessage(message, uint24(block.timestamp % (24 * 3600)));
        console.log(string.concat("new message: ", registry.messages(address(this)).content));
    }
}
