import {expect} from './chai-setup';
import {ethers, deployments} from '@nomiclabs/buidler';

describe('{{=_.pascalCase(it.contractName)}}', function () {
  it('should work', async function () {
    await deployments.fixture();
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}');
    expect({{=_.camelCase(it.contractName)}}Contract.address).to.be.a('string');
  });

  it('should fails', async function () {
    await deployments.fixture();
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}');
    expect({{=_.camelCase(it.contractName)}}Contract.fails('testing')).to.be.revertedWith('fails');
  });

  it('should return 2 as id', async function () {
    await deployments.fixture();
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}');
    expect(await {{=_.camelCase(it.contractName)}}Contract.getId()).to.equal(2);
  });
});
