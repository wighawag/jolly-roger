import {BuidlerRuntimeEnvironment, DeployFunction} from '@nomiclabs/buidler/types';

const func: DeployFunction = async function (bre: BuidlerRuntimeEnvironment) {
  const {deployer} = await bre.getNamedAccounts();
  const {deploy} = bre.deployments;
  const useProxy = !bre.network.live;

  // proxy only in non-live network (localhost and buidlerevm) enabling HCR (Hot Contract Replaement)
  // in live network, proxy is disabled and constructor is invoked
  await deploy('{{=_.pascalCase(it.contractName)}}', {from: deployer, proxy: useProxy && 'postUpgrade', args: [2], log: true});

  return !useProxy; // when live network, record the script as executed to prevent rexecution
};
export default func;
