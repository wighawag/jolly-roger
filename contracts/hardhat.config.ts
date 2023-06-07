import {loadEnv} from 'ldenv';
loadEnv();
import '@nomicfoundation/hardhat-network-helpers';
import 'solidity-coverage';
import {addForkConfiguration, addNetworksFromEnv} from 'hardhat-rocketh';

export default {
	solidity: '0.8.20',
	networks: addForkConfiguration(
		addNetworksFromEnv({
			hardhat: {
				initialBaseFeePerGas: 0,
			},
		})
	),
	paths: {
		sources: 'src',
	},
};
