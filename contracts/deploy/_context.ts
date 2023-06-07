import artifacts from '../generated/artifacts';
import 'rocketh-signer';

export const context = {
	accounts: {
		// TODO accounts per network, with index, etc...
		// deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
		// deployer: '0x61c461EcC993aaDEB7e4b47E96d1B8cC37314B20',
		// deployer: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
		deployer: {
			default: 0,
			sepolia: '0x61c461EcC993aaDEB7e4b47E96d1B8cC37314B20',
		},
	},
	artifacts,
} as const;
