import {getParamsFromURL, getParamsFromURLHash} from './utils/web';
import {url} from './utils/url';

export const startTime = Math.floor(Date.now() / 1000);
export const hashParams = getParamsFromURLHash();
export const params = getParamsFromURL();
export const VERSION = '1';

// setup global query params, that need to remain on page changes // require pages link to use the `url function`
url.paramsOnLoad = params;
url.globalQueryParams = ['debug', 'log', 'subgraph', 'ethnode'];
