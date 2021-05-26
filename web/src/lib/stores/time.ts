import {blockTime} from '$lib/config';
import {readable} from 'svelte/store';

const performanceAvailable = typeof performance !== 'undefined'; // server

export let startTime = performanceAvailable ? (Date.now() - performance.now()) / 1000 : Date.now() / 1000;

export function now(): number {
  if (performanceAvailable) {
    return Math.floor(performance.now() / 1000) + startTime;
  } else {
    return Math.floor(Date.now() / 1000) + startTime;
  }
}

let _corrected = false;
export function correctTime(actualTime: number): void {
  const currentTime = now();
  const diff = actualTime - currentTime;
  if (Math.abs(diff) > blockTime) {
    // only adapt if difference is significant
    startTime += diff;
  }
  _corrected = true;
}

export function isCorrected(): boolean {
  return _corrected;
}

export const time = readable(now(), function start(set) {
  const interval = setInterval(() => {
    set(now());
  }, 1000);

  return function stop() {
    clearInterval(interval);
  };
});

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as unknown as any).time = {
    now,
    startTime,
    correctTime,
    isCorrected,
    time,
  };
}
