module.exports = async ({getNamedAccounts, deployments}) => {
  const {deployer} = await getNamedAccounts();
  const {deploy} = deployments;

  await deploy("{{=_.pascalCase(it.contractName)}}", {from: deployer});
};
