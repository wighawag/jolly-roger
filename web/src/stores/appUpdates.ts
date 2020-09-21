import {writable} from 'svelte/store';

export const updateAvailable = writable(false);

// USEFUL FOR DEBUGGING:
if (typeof window !== 'undefined') {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).updateAvailable = updateAvailable;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
