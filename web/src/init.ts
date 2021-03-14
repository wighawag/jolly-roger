import {hookup} from 'named-logs-console';
import {getParamsFromURL, getParamsFromURLHash} from './lib/utils/web';
hookup();

export let startTime = Math.floor(Date.now() / 1000);
export const hashParams = getParamsFromURLHash();
export const params = getParamsFromURL();
export const VERSION = '1';

function setWindowStartTime() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).startTime = startTime;
}
setWindowStartTime();

export function init(): void {
  startTime = Math.floor(Date.now() / 1000);
  setWindowStartTime();
}
