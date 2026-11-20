import {defineCapability} from './define';
import type {ENSService} from '$lib/core/ens/types';

/**
 * The ENS capability: resolve names / addresses / avatars.
 *
 * Optional (no fallback): components that use it must render correctly without
 * it, e.g. show a truncated address instead of a resolved name. It lives here
 * rather than under UI because it is a domain capability that non-UI code
 * (stores, formatters) could also consume.
 */
const ensCapability = defineCapability<ENSService>('ens');

export const provideENS = ensCapability.provide;
export const useENS = ensCapability.use;
