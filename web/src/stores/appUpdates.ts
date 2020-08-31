import {writable} from 'svelte/store';

export const updateAvailable = writable(false);

/* eslint-disable @typescript-eslint/no-explicit-any */
if (typeof window !== 'undefined') {
  (window as any).updateAvailable = updateAvailable;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
