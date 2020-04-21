pragma solidity 0.6.5;

contract {{=_.pascalCase(contractName)}}{

    event NameChanged(address indexed user, string name);

    function setName(string name) external {
        _names[msg.sender] = name;
        emit NameChanged(msg.sender, name);
    }

    // ////////////////// CONSTRUCTOR /////////////////////////////

    constructor() {

    }

    // ///////////////////     DATA      //////////////////////////

    mapping(address => string) _names;

}
