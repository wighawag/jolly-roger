import {defineCapability} from './define';
import type {Faucet} from '$lib/core/ui/faucet/faucet';

/**
 * The faucet capability: where an empty account can be funded from.
 *
 * Optional (no fallback), like the block explorer: without it no faucet is
 * offered (`faucetConfigured(useFaucet())` is false). The app composes its
 * faucet from its configuration and provides it at the root (jolly-roger:
 * `$lib/index.ts` and routes/+layout.svelte).
 */
const faucetCapability = defineCapability<Faucet>('faucet');

export const provideFaucet = faucetCapability.provide;
export const useFaucet = faucetCapability.use;
