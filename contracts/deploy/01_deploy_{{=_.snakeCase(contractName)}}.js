module.exports = async ({getNamedAccounts, deployments}) => {
  const {deployer} = await getNamedAccounts();
  const {deployIfDifferent, log} = deployments;

  const {{=_.camelCase(contractName)}}DeployResult = await deployIfDifferent(
    ["data"],
    "{{=_.pascalCase(contractName)}}",
    {from: deployer},
    "{{=_.pascalCase(contractName)}}"
  );
  if ({{=_.camelCase(contractName)}}DeployResult.newlyDeployed) {
    const {{=_.camelCase(contractName)}}Contract = {{=_.camelCase(contractName)}}DeployResult.contract;
    log(`{{=_.pascalCase(contractName)}}deployed at ${{{=_.camelCase(contractName)}}Contract.address} for ${{{=_.camelCase(contractName)}}DeployResult.receipt.gasUsed} gas`);
  }
};
