const {getNamedAccounts, ethers, deployments} = require('@nomiclabs/buidler');

async function main() {
    const {deployer} = await getNamedAccounts();
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract({{=_.pascalCase(it.contractName)}});
    // TODO seed with data
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });