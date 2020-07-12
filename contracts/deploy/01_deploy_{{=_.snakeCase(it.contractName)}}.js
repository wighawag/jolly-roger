module.exports = async ({getNamedAccounts, deployments, network}) => {
  const {deployer} = await getNamedAccounts();
  const {deploy} = deployments;
  const dev = !network.live;

  // proxy only in dev mode enabling HCR (Hot Contract Replaement)
  // try with `yarn dev` which will deploy in `localhost` wiht `buidler --network localhost deploy --watch`
  // you could also using `buidler node --watch`
  await deploy("{{=_.pascalCase(it.contractName)}}", {from: deployer, proxy: dev});

  return !dev; // will never be executed again on non-dev mode
};
