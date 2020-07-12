pragma solidity 0.6.5;

import "buidler-deploy/solc_0.6/proxy/Proxied.sol";
import "@nomiclabs/buidler/console.sol";

contract {{=_.pascalCase(it.contractName)}} is Proxied {
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

    function getId() external view returns (uint256) {
        return _id;
    }

    function postUpgrade(uint256 id) public proxied {
        require(id != 0, "zero id not allowed");

        // can only be set once, this way postUpgrade can be called on a new upgrade safely, while still serving as constructor function
        if (_id == 0) {
            _id = id;
        }
    }

    // ////////////////// CONSTRUCTOR /////////////////////////////

    constructor(uint256 id) public {
        postUpgrade(id); // the proxied modifier from `buidler-deploy` ensure postUpgrade effect can only be used once when the contract is deployed without proxy
    }

    // ///////////////////     DATA      //////////////////////////

    mapping(address => string) _names;
    uint256 _id;
}
