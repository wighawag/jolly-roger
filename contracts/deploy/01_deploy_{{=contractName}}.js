module.exports = async ({getNamedAccounts, deployments}) => {
  const {deployer} = await getNamedAccounts();
  const {deployIfDifferent, log} = deployments;

  const {{=contractName}}DeployResult = await deployIfDifferent(
    ["data"],
    "{{=contractName}}",
    {from: deployer},
    "{{=contractName}}"
  );
  if ({{=contractName}}DeployResult.newlyDeployed) {
    const {{=contractName}}Contract = {{=contractName}}DeployResult.contract;
    log(`{{=contractName}}deployed at ${{{=contractName}}Contract.address} for ${{{=contractName}}DeployResult.receipt.gasUsed} gas`);
  }
};
