import networks from './data/networks.json';

export type NetworkWalletData = {
	rpcUrls?: string[];
	blockExplorerUrls?: string[];
	chainName?: string;
	iconUrls?: string[];
	nativeCurrency?: {
		name: string;
		symbol: string;
		decimals: number;
	};
};
export type NetworkData = {
	config: NetworkWalletData;
	finality: number;
	averageBblockTime: number;
};

export function getNetworkConfig(chainId: string) {
	const network = (networks as any)[chainId] as NetworkData | undefined;
	return network?.config;
}
