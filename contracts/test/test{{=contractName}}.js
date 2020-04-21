
const {assert, should, expect} = require("local-chai");
const {ethers, getNamedAccounts} = require("@nomiclabs/buidler");

describe("{{=contractName}}", function () {
  it("should work", async function() {
    const {{=contractName}}Contract = await ethers.getContract("{{=contractName}}");
    expect(true).to.be('boolean');
  });
});
