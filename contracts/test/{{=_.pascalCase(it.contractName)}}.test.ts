import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts} from 'hardhat';

describe('{{=_.pascalCase(it.contractName)}}', function () {
  it('should work', async function () {
    await deployments.fixture('{{=_.pascalCase(it.contractName)}}');
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}');
    expect({{=_.camelCase(it.contractName)}}Contract.address).to.be.a('string');
  });

  it('should fails', async function () {
    await deployments.fixture('{{=_.pascalCase(it.contractName)}}');
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}');
    expect({{=_.camelCase(it.contractName)}}Contract.fails('testing')).to.be.revertedWith('fails');
  });

  it('setMessage works', async function () {
    await deployments.fixture('{{=_.pascalCase(it.contractName)}}');
    const others = await getUnnamedAccounts();
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}', others[0]);
    const testMessage = 'Hello World';
    await expect({{=_.camelCase(it.contractName)}}Contract.setMessage(testMessage))
      .to.emit({{=_.camelCase(it.contractName)}}Contract, 'MessageChanged')
      .withArgs(others[0], testMessage);
  });
});
