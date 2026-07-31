import {createPublicClient, http} from 'viem';
import {mainnet} from 'viem/chains';
import {logs} from 'named-logs';
import {PUBLIC_ENS_NODE_URL} from '$env/static/public';

const logger = logs('ens');

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

// Create the public client once for all ENS lookups
/**
 * Creates an ENS service with in-memory caching.
 * Each address lookup is cached, preventing duplicate requests.
 */
export function createENSService(): ENSService {
	// Created only when ENS is enabled. routes/+layout.svelte gates this on a
	// non-empty PUBLIC_ENS_NODE_URL; an empty value means ENS is disabled and
	// this function is never called, so no client (and no RPC) is created.
	const publicClient = createPublicClient({
		chain: mainnet,
		transport: http(PUBLIC_ENS_NODE_URL || undefined),
	});

	const cache: ENSCache = new Map();
	const addressCache: ENSAddressCache = new Map();
	const avatarCache: ENSAvatarCache = new Map();
	const pendingRequests = new Map<`0x${string}`, Promise<string | null>>();
	const pendingAddressRequests = new Map<
		string,
		Promise<`0x${string}` | null>
	>();
	const pendingAvatarRequests = new Map<
		`0x${string}`,
		Promise<string | null>
	>();

	/**
	 * Get the current ENS state for an address (synchronous).
	 * Returns the cached state or a default loading state.
	 */
	function getENSState(address: `0x${string}`): ENSResult {
		const cached = cache.get(address);
		if (cached) {
			return cached;
		}
		return {name: null, loading: false};
	}

	/**
	 * Get the current address state for an ENS name (synchronous).
	 * Returns the cached state or a default loading state.
	 */
	function getAddressState(name: string): ENSAddressResult {
		const normalizedName = name.toLowerCase();
		const cached = addressCache.get(normalizedName);
		if (cached) {
			return cached;
		}
		return {address: null, loading: false};
	}

	/**
	 * Fetch ENS name for an address with caching.
	 * If a request is already in progress for this address, returns the same promise.
	 * If the result is cached, returns it immediately.
	 */
	async function fetchENS(address: `0x${string}`): Promise<string | null> {
		// Check if we already have a cached result
		const cached = cache.get(address);
		if (cached && !cached.loading) {
			logger.debug(`ENS cache hit for ${address}: ${cached.name}`);
			return cached.name;
		}

		// Check if there's already a pending request for this address
		const pending = pendingRequests.get(address);
		if (pending) {
			logger.debug(`ENS request already pending for ${address}`);
			return pending;
		}

		// Set loading state
		cache.set(address, {name: null, loading: true});

		// Create the fetch promise
		const fetchPromise = (async (): Promise<string | null> => {
			try {
				logger.debug(`Fetching ENS for ${address}`);
				const name = await publicClient.getEnsName({address});
				logger.debug(`ENS resolved for ${address}: ${name}`);

				cache.set(address, {name, loading: false});
				return name;
			} catch (error) {
				logger.debug(`Failed to fetch ENS for ${address}`, error);
				cache.set(address, {
					name: null,
					loading: false,
					error: error instanceof Error ? error : new Error(String(error)),
				});
				return null;
			} finally {
				pendingRequests.delete(address);
			}
		})();

		pendingRequests.set(address, fetchPromise);
		return fetchPromise;
	}

	/**
	 * Resolve an ENS name to an address with caching.
	 * If a request is already in progress for this name, returns the same promise.
	 * If the result is cached, returns it immediately.
	 */
	async function resolveAddress(name: string): Promise<`0x${string}` | null> {
		const normalizedName = name.toLowerCase();

		// Check if we already have a cached result
		const cached = addressCache.get(normalizedName);
		if (cached && !cached.loading) {
			logger.debug(`ENS address cache hit for ${name}: ${cached.address}`);
			return cached.address;
		}

		// Check if there's already a pending request for this name
		const pending = pendingAddressRequests.get(normalizedName);
		if (pending) {
			logger.debug(`ENS address request already pending for ${name}`);
			return pending;
		}

		// Set loading state
		addressCache.set(normalizedName, {address: null, loading: true});

		// Create the fetch promise
		const fetchPromise = (async (): Promise<`0x${string}` | null> => {
			try {
				logger.debug(`Resolving ENS address for ${name}`);
				const address = await publicClient.getEnsAddress({
					name: normalizedName,
				});
				logger.debug(`ENS address resolved for ${name}: ${address}`);

				addressCache.set(normalizedName, {address, loading: false});
				return address;
			} catch (error) {
				logger.debug(`Failed to resolve ENS address for ${name}`, error);
				addressCache.set(normalizedName, {
					address: null,
					loading: false,
					error: error instanceof Error ? error : new Error(String(error)),
				});
				return null;
			} finally {
				pendingAddressRequests.delete(normalizedName);
			}
		})();

		pendingAddressRequests.set(normalizedName, fetchPromise);
		return fetchPromise;
	}

	/**
	 * Get the current ENS avatar state for an address (synchronous).
	 * Returns the cached state or a default loading state.
	 */
	function getENSAvatarState(address: `0x${string}`): ENSAvatarResult {
		const cached = avatarCache.get(address);
		if (cached) {
			return cached;
		}
		return {avatar: null, loading: false};
	}

	/**
	 * Fetch ENS avatar for an address with caching.
	 * First resolves the ENS name, then fetches the avatar.
	 * If a request is already in progress for this address, returns the same promise.
	 * If the result is cached, returns it immediately.
	 */
	async function fetchENSAvatar(
		address: `0x${string}`,
	): Promise<string | null> {
		// Check if we already have a cached result
		const cached = avatarCache.get(address);
		if (cached && !cached.loading) {
			logger.debug(`ENS avatar cache hit for ${address}: ${cached.avatar}`);
			return cached.avatar;
		}

		// Check if there's already a pending request for this address
		const pending = pendingAvatarRequests.get(address);
		if (pending) {
			logger.debug(`ENS avatar request already pending for ${address}`);
			return pending;
		}

		// Set loading state
		avatarCache.set(address, {avatar: null, loading: true});

		// Create the fetch promise
		const fetchPromise = (async (): Promise<string | null> => {
			try {
				logger.debug(`Fetching ENS avatar for ${address}`);

				// First, get the ENS name for this address
				const name = await fetchENS(address);
				if (!name) {
					logger.debug(`No ENS name found for ${address}, cannot fetch avatar`);
					avatarCache.set(address, {avatar: null, loading: false});
					return null;
				}

				// Now fetch the avatar using the ENS name
				const avatar = await publicClient.getEnsAvatar({name});
				logger.debug(`ENS avatar resolved for ${address}: ${avatar}`);

				avatarCache.set(address, {avatar, loading: false});
				return avatar;
			} catch (error) {
				logger.debug(`Failed to fetch ENS avatar for ${address}`, error);
				avatarCache.set(address, {
					avatar: null,
					loading: false,
					error: error instanceof Error ? error : new Error(String(error)),
				});
				return null;
			} finally {
				pendingAvatarRequests.delete(address);
			}
		})();

		pendingAvatarRequests.set(address, fetchPromise);
		return fetchPromise;
	}

	return {
		fetchENS,
		getENSState,
		resolveAddress,
		getAddressState,
		fetchENSAvatar,
		getENSAvatarState,
	};
}
