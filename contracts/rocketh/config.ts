// ----------------------------------------------------------------------------
// Typed Config
// ----------------------------------------------------------------------------
import type {
	EnhancedEnvironment,
	UnknownDeployments,
	UserConfig,
} from 'rocketh/types';

// this one provide a protocol supporting private key as account
import {privateKey} from '@rocketh/signer';

// we define our config and export it as "config"
export const config = {
	accounts: {
		deployer: {
			default: 0,
		},
		admin: {
			default: 1,
		},
	},
	environments: {
		localhost: {
			chain: 31337,
			overrides: {
				autoMine: true,
			},
		},
	},
	// Chain properties are exported with the deployments and read by the web app
	// (see web/src/lib/context/config.ts). Uncomment to denominate the local
	// signer's gas balance as CREDITS - "12 credits" instead of "0.0012 ETH" -
	// so a player reads how many moves they can still make rather than a wei
	// figure. See web/src/lib/core/connection/credits.ts.
	//
	// BOTH are required, and neither is defaulted: half a configuration would
	// produce a confident, wrong move count, so the app falls back to showing
	// native currency unless it knows what an action actually costs.
	//
	// chains: {
	// 	31337: {
	// 		properties: {
	// 			// The worst gas price this chain is expected to charge, in wei.
	// 			// A string, because a mainnet-scale value does not survive JSON as
	// 			// a number. Pessimistic on purpose: it makes the credit count a
	// 			// floor the player always gets, rather than one that drifts down
	// 			// with the mempool while they sit still.
	// 			expectedWorstGasPrice: '1000000000',
	// 			// Gas one credit buys, i.e. what a single user action costs. Sum
	// 			// the worst-case gas of the transactions one move sends.
	// 			creditsGasMultiplier: 100000,
	// 			// Credits per top-up. Optional; defaults to 100.
	// 			creditsPerTopUp: 100,
	// 		},
	// 	},
	// },
	data: {},
	signerProtocols: {
		privateKey,
	},
} as const satisfies UserConfig;

// then we import each extensions we are interested in using in our deploy script or elsewhere

// this one provide a deploy function
import * as deployExtension from '@rocketh/deploy';
// this one provide read,execute functions
import * as readExecuteExtension from '@rocketh/read-execute';
// this one provide a deployViaProxy function that let you declaratively
//  deploy proxy based contracts
import * as deployProxyExtension from '@rocketh/proxy';
// this one provide a viem handle to clients and contracts
import * as viemExtension from '@rocketh/viem';

// and export them as a unified object
const extensions = {
	...deployExtension,
	...readExecuteExtension,
	...deployProxyExtension,
	...viemExtension,
};
export {extensions};

// then we also export the types that our config ehibit so other can use it

type Extensions = typeof extensions;
type Accounts = typeof config.accounts;
type Data = typeof config.data;
type Environment = EnhancedEnvironment<
	Accounts,
	Data,
	UnknownDeployments,
	Extensions
>;

export type {Extensions, Accounts, Data, Environment};
