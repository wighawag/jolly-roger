const {expect} = require("chai-setup");
const {ethers, deployments} = require("@nomiclabs/buidler");

describe("{{=_.pascalCase(it.contractName)}}", function () {
  it("should work", async function () {
    await deployments.fixture();
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract("{{=_.pascalCase(it.contractName)}}");
    expect(true).to.be.a("boolean");
    expect({{=_.camelCase(it.contractName)}}Contract.address).to.be.a("string");
  });
});
