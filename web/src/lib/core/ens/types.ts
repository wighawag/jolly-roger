/**
 * The ENS service's types, apart from the service itself (`./index.ts`, which
 * reads `PUBLIC_ENS_NODE_URL`): what the ENS capability and the ethereum UI
 * import, so they copy into an app with no ENS configuration.
 */
export type ENSResult = {
	name: string | null;
	loading: boolean;
	error?: Error;
};

export type ENSAddressResult = {
	address: `0x${string}` | null;
	loading: boolean;
	error?: Error;
};

export type ENSAvatarResult = {
	avatar: string | null;
	loading: boolean;
	error?: Error;
};

export type ENSCache = Map<`0x${string}`, ENSResult>;
export type ENSAddressCache = Map<string, ENSAddressResult>;
export type ENSAvatarCache = Map<`0x${string}`, ENSAvatarResult>;

export type ENSService = {
	fetchENS: (address: `0x${string}`) => Promise<string | null>;
	getENSState: (address: `0x${string}`) => ENSResult;
	resolveAddress: (name: string) => Promise<`0x${string}` | null>;
	getAddressState: (name: string) => ENSAddressResult;
	fetchENSAvatar: (address: `0x${string}`) => Promise<string | null>;
	getENSAvatarState: (address: `0x${string}`) => ENSAvatarResult;
};
