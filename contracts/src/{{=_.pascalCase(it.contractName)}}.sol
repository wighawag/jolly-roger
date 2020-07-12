pragma solidity 0.6.5;

import "@nomiclabs/buidler/console.sol";

contract {{=_.pascalCase(it.contractName)}} {
    event NameChanged(address indexed user, string name);

    function setName(string calldata name) external {
        _names[msg.sender] = name;
        emit NameChanged(msg.sender, name);
    }

    function fails(string calldata name) external {
        console.log("it fails: '%s'", name);
        emit NameChanged(msg.sender, name);
        revert("fails");
    }

    // ////////////////// CONSTRUCTOR /////////////////////////////

    constructor() public {
        _owner = msg.sender;
    }

    // ///////////////////     DATA      //////////////////////////

    mapping(address => string) _names;
    address _owner;
}
