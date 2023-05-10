import {base} from '$app/paths';
import {params, globalQueryParams} from '$lib/config';
import {getParamsFromURL, queryStringifyNoArray} from './web';

export function pathname(p: string, hash?: string) {
	if (!p.endsWith('/')) {
		p += '/';
	}
	let path = `${base}${p}${getQueryStringToKeep(p)}${hash ? `#${hash}` : ''}`;
	return path;
}

function getQueryStringToKeep(p: string): string {
	if (globalQueryParams && globalQueryParams.length > 0) {
		const {params: paramFromPath} = getParamsFromURL(p);
		for (const queryParam of globalQueryParams) {
			if (typeof params[queryParam] != 'undefined' && typeof paramFromPath[queryParam] === 'undefined') {
				paramFromPath[queryParam] = params[queryParam];
			}
		}
		return queryStringifyNoArray(paramFromPath);
	} else {
		return '';
	}
}

export function url(p: string, hash?: string) {
	return `${base}${p}${getQueryStringToKeep(p)}${hash ? `#${hash}` : ''}`;
}

export function isSameURL(a: string, b: string): boolean {
	return a === b || a === pathname(b);
}

export function isParentURL(a: string, b: string): boolean {
	return a.startsWith(pathname(b));
}
