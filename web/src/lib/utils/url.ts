import {base} from '$app/paths';
import {getParamsFromURL, queryStringifyNoArray} from './web';
import {params, globalQueryParams} from '$lib/config';

export function url(path: string): string {
  const paramFromPath = getParamsFromURL(path);
  for (const queryParam of globalQueryParams) {
    if (typeof params[queryParam] != 'undefined' && typeof paramFromPath[queryParam] === 'undefined') {
      paramFromPath[queryParam] = params[queryParam];
    }
  }
  return `${base}/${path}${queryStringifyNoArray(paramFromPath)}`;
}

export function urlOfPath(url: string, path: string): boolean {
  const basicUrl = url.split('?')[0].split('#')[0];
  return basicUrl.replace(base, '').replace(/^\/+|\/+$/g, '') === path.replace(/^\/+|\/+$/g, '');
}
