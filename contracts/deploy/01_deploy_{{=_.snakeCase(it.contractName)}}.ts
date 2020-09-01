import {BuidlerRuntimeEnvironment, DeployFunction} from '@nomiclabs/buidler/types';

const func: DeployFunction = async function (bre: BuidlerRuntimeEnvironment) {
  const {deployer} = await bre.getNamedAccounts();
  const {deploy} = bre.deployments;
  const dev = !bre.network.live;

  // proxy only in dev mode enabling HCR (Hot Contract Replaement)
  // try with `yarn dev` which will deploy in `localhost` wiht `buidler --network localhost deploy --watch`
  // you could also using `buidler node --watch`
  await deploy('{{=_.pascalCase(it.contractName)}}', {from: deployer, proxy: dev && 'postUpgrade', args: [2], log: true});

  return !dev; // will never be executed again on non-dev mode
};
export default func;
