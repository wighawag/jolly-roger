const {getNamedAccounts, ethers, deployments} = require("@nomiclabs/buidler");

async function main() {
  const {deployer, users} = await getNamedAccounts();
  for (let i = 0; i < 4; i++) {
    const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract("{{=_.pascalCase(it.contractName)}}", users[i]);
    await {{=_.camelCase(it.contractName)}}Contract.setName("" + Math.floor(Date.now() / 1000));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
