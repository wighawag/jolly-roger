import {loadEnv} from 'ldenv';
loadEnv();
import '@nomicfoundation/hardhat-network-helpers';
import 'solidity-coverage';
import 'hardhat-rocketh';
import {addForkConfiguration, addNetworksFromEnv} from 'hardhat-rocketh';

export default {
	solidity: '0.8.20',
	networks:
		// this setup forking for netwoirk if env var HARDHAT_FORK is set
		addForkConfiguration(
			// this add network for each respective env var found (ETH_NODE_URI_<network>)
			addNetworksFromEnv({
				hardhat: {
					initialBaseFeePerGas: 0,
					mining: {
						interval: process.env['BLOCK_TIME'] ? parseInt(process.env['BLOCK_TIME']) : undefined,
					},
				},
			})
		),
	paths: {
		sources: 'src',
	},
};
