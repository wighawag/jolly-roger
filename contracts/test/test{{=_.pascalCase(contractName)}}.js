
const {assert, should, expect} = require("local-chai");
const {ethers, getNamedAccounts} = require("@nomiclabs/buidler");

describe("{{=_.pascalCase(contractName)}}", function () {
  it("should work", async function() {
    const {{=_.camelCase(contractName)}}Contract = await ethers.getContract("{{=_.pascalCase(contractName)}}");
    expect(true).to.be('boolean');
  });
});
