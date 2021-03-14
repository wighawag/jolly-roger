import { blockTime } from '../config';
import {readable} from 'svelte/store';
import {startTime as initStartTime} from '../init';

export let startTime = initStartTime;

export function now(): number {
  return Math.floor(performance.now() / 1000) + startTime - blockTime;
}

let _corrected = false;
export function correctTime(actualTime: number): void {
  const currentTime = now();
  const diff = actualTime - currentTime;
  if (Math.abs(diff) > 60) {
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

// TODO remove
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).time = {
  now,
  startTime,
  correctTime,
  isCorrected,
  time,
};
// console.log((window as any).time);
