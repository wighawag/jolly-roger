module.exports = async ({getNamedAccounts, deployments}) => {
  const {deployer} = await getNamedAccounts();
  const {deployIfDifferent, log} = deployments;

  const {{=_.camelCase(it.contractName)}}DeployResult = await deployIfDifferent(
    ["data"],
    "{{=_.pascalCase(it.contractName)}}",
    {from: deployer},
    "{{=_.pascalCase(it.contractName)}}"
  );
  if ({{=_.camelCase(it.contractName)}}DeployResult.newlyDeployed) {
    const {{=_.camelCase(it.contractName)}}Contract = {{=_.camelCase(it.contractName)}}DeployResult.contract;
    log(
      `{{=_.pascalCase(it.contractName)}}deployed at ${{{=_.camelCase(it.contractName)}}Contract.address} for ${{{=_.camelCase(it.contractName)}}DeployResult.receipt.gasUsed} gas`
    );
  }
};
