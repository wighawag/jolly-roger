import {writable, type Readable} from 'svelte/store';
import type {ENSService} from '$lib/core/ens/types';

export type ENSNameState = {name: string | null; loading: boolean};

export type ENSNameStore = Readable<ENSNameState> & {
	/** Point the store at a new address (resets and, unless lazy, resolves). */
	setAddress: (address: `0x${string}` | undefined) => void;
	/** Trigger a (lazy) resolution on demand; no-op once attempted. */
	resolve: () => void;
};

/**
 * Store for ENS name resolution of a single address. Owns the fetch +
 * stale-guard + loading flag so components only read `$store` and call
 * `setAddress` when their address prop changes.
 *
 * @param ensService optional ENS capability; the store is inert without it.
 * @param options.lazy when true, resolution only runs after `resolve()` is
 *   called (used for on-demand lookups such as a popover opening).
 */
export function createENSNameStore(
	ensService: ENSService | undefined,
	options: {lazy?: boolean; seedFromCache?: boolean} = {},
): ENSNameStore {
	// lazy: only fetch when resolve() is called (used behind the avatar popover).
	// seedFromCache: synchronously populate a cached name (and, in lazy mode,
	// treat a cache hit as already attempted so resolve() won't re-fetch). These
	// defaults reproduce the original components: Address (eager, no seeding)
	// and EthereumAvatar (lazy, cache-seeded).
	const {lazy = false, seedFromCache = lazy} = options;
	const {subscribe, set, update} = writable<ENSNameState>({
		name: null,
		loading: false,
	});

	let currentAddress: `0x${string}` | undefined;
	let attempted = false;

	async function load(addr: `0x${string}`) {
		if (!addr || !ensService) return;
		set({name: null, loading: true});
		try {
			const result = await ensService.fetchENS(addr);
			if (addr === currentAddress) set({name: result, loading: false});
		} finally {
			// Match the original try/finally: reset loading even on failure and
			// let the rejection propagate.
			if (addr === currentAddress) {
				update((state) => ({name: state.name, loading: false}));
			}
		}
	}

	function setAddress(address: `0x${string}` | undefined) {
		currentAddress = address;
		attempted = false;
		set({name: null, loading: false});

		if (!address || !ensService) return;

		// Synchronous cache seed (no blink for cached names).
		if (seedFromCache) {
			const cached = ensService.getENSState(address);
			if (cached.name) {
				set({name: cached.name, loading: false});
				attempted = true;
			}
		}

		if (lazy || attempted) return;
		attempted = true;
		load(address);
	}

	function resolve() {
		if (attempted || !currentAddress || !ensService) return;
		attempted = true;
		load(currentAddress);
	}

	return {subscribe, setAddress, resolve};
}

export type ENSAvatarState = {avatar: string | null; loading: boolean};

export type ENSAvatarStore = Readable<ENSAvatarState> & {
	setAddress: (address: `0x${string}` | undefined) => void;
};

/**
 * Store for ENS avatar resolution of a single address, seeded from the ENS
 * service cache to avoid a blockie -> avatar flash for cached entries.
 */
export function createENSAvatarStore(
	ensService: ENSService | undefined,
): ENSAvatarStore {
	const {subscribe, set, update} = writable<ENSAvatarState>({
		avatar: null,
		loading: false,
	});

	let currentAddress: `0x${string}` | undefined;

	async function load(addr: `0x${string}`) {
		if (!ensService) return;
		// Match the original: keep the current avatar visible, just flag loading.
		update((state) => ({avatar: state.avatar, loading: true}));
		try {
			const result = await ensService.fetchENSAvatar(addr);
			if (addr === currentAddress) set({avatar: result, loading: false});
		} finally {
			// try/finally (no catch) mirrors the original: reset loading even on
			// failure and let the rejection propagate.
			if (addr === currentAddress) {
				update((state) => ({avatar: state.avatar, loading: false}));
			}
		}
	}

	function setAddress(address: `0x${string}` | undefined) {
		currentAddress = address;
		if (!ensService || !address) {
			set({avatar: null, loading: false});
			return;
		}

		// Synchronous cache check first: no blink for cached avatars.
		const cached = ensService.getENSAvatarState(address);
		if (cached.avatar) {
			set({avatar: cached.avatar, loading: false});
		} else if (!cached.loading) {
			set({avatar: null, loading: false});
			load(address);
		}
	}

	return {subscribe, setAddress};
}
