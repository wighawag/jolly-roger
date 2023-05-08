// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {DeployScript, Deployer} from "forge-deploy/DeployScript.sol";
import {ProxiedDeployerFunctions, ProxiedDeployOptions} from "generated/deployer/ProxiedDeployerFunctions.g.sol";
import {GreetingsRegistry} from "src/GreetingsRegistry.sol";

contract Deployments is DeployScript {
    using ProxiedDeployerFunctions for Deployer;

    function deploy() external returns (GreetingsRegistry) {
        return deployer.deploy_GreetingsRegistry(
            "Registry", "", ProxiedDeployOptions({proxyOnTag: "testnet", proxyOwner: vm.envAddress("DEPLOYER")})
        );
    }
}
