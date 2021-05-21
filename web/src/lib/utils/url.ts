import {base} from '$app/paths';
import {getParamsFromURL, queryStringifyNoArray} from './web';

export const url: {
  (path: string): string;
  globalQueryParams: string[];
  paramsOnLoad: Record<string, string>;
} = function (path: string): string {
  const paramFromPath = getParamsFromURL(path);
  for (const queryParam of url.globalQueryParams) {
    if (url.paramsOnLoad[queryParam] && !paramFromPath[queryParam]) {
      paramFromPath[queryParam] = url.paramsOnLoad[queryParam];
    }
  }
  return `${base}/${path}${queryStringifyNoArray(paramFromPath)}`;
};
url.paramsOnLoad = {};
url.globalQueryParams = [];

export function urlOfPath(url: string, path: string): boolean {
  const basicUrl = url.split('?')[0].split('#')[0];
  return basicUrl.replace(base, '').replace(/^\/+|\/+$/g, '') === path.replace(/^\/+|\/+$/g, '');
}
