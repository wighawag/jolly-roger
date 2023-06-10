import artifacts from '../generated/artifacts';
import 'rocketh-signer';

export const context = {
	accounts: {
		deployer: {
			default: 0,
		},
	},
	artifacts,
} as const;
