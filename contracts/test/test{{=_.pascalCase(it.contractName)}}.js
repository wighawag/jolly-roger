
const {assert, should, expect} = require("local-chai");
const {ethers, getNamedAccounts} = require("@nomiclabs/buidler");

describe("{{=_.pascalCase(it.contractName)}}", function () {
  it("should work", async function() {
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract("{{=_.pascalCase(it.contractName)}}");
    expect(true).to.be('boolean');
  });
});
