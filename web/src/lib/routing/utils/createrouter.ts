import {
  prepareRoutes,
  createRouter as curi_createRouter,
  RouterOptions,
} from '@curi/router';
import {browser, createBase} from '@hickory/browser';
import type {CuriRouter} from '@curi/types';

type ComponentModule = {default: unknown};

function parseQueryNoArray(
  onlyKeys?: string[]
): (queryString: string) => Record<string, string> {
  return (queryString: string): Record<string, string> => {
    if (!queryString) {
      return {};
    }
    const query: Record<string, string> = {};
    const pairs = (queryString[0] === '?'
      ? queryString.substr(1)
      : queryString
    ).split('&');
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i].split('=');
      const key = decodeURIComponent(pair[0]);
      if (!onlyKeys || onlyKeys.indexOf(key) !== -1) {
        query[key] = decodeURIComponent(pair[1] || '');
      }
    }
    return query;
  };
}

function queryStringifyNoArray(
  prefix?: string
): (query: Record<string, string>) => string {
  return (query: Record<string, string>): string => {
    if (!query) {
      return '';
    }
    let str = prefix || '';
    for (const key of Object.keys(query)) {
      const value = query[key];
      str += `${str === '' ? '?' : '&'}${key}=${value}`;
    }
    return str;
  };
}

export function createRouter(
  pages: {
    name: string;
    path: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component?: any;
    asyncComponent?: () => Promise<ComponentModule>;
  }[],
  globalQueryStrings?: string[]
): CuriRouter {
  const routesConfig = [];

  for (const routePath of pages) {
    const asyncComponent = routePath.asyncComponent;
    if (asyncComponent) {
      routesConfig.push({
        name: routePath.name,
        path:
          !routePath.path || routePath.path == '/' ? '' : routePath.path + '/',
        respond({resolved, error}: {resolved: string; error: unknown}) {
          let data;
          if (error) {
            data = {error};
          }
          return {
            body: resolved,
            data,
          };
        },
        resolve() {
          return asyncComponent()
            .then((c) => c.default)
            .catch(() => {
              window.onFailingResource && window.onFailingResource();
            });
        },
      });
    } else {
      routesConfig.push({
        name: routePath.name,
        path:
          !routePath.path || routePath.path == '/' ? '' : routePath.path + '/',
        respond() {
          return {
            body: routePath.component,
          };
        },
      });
    }
  }

  const current = parseQueryNoArray(globalQueryStrings)(location.search);
  const prefix = queryStringifyNoArray()(current);

  const options: RouterOptions = {
    history: {
      query: {
        parse: parseQueryNoArray(),
        stringify: queryStringifyNoArray(prefix),
      },
    },
  };

  if (typeof window.basepath !== 'undefined' && window.basepath !== '') {
    let base = window.basepath;
    if (base.endsWith('/')) {
      base = base.slice(0, base.length - 1);
    }
    if (base !== '') {
      if (options.history) {
        options.history.base = createBase(base);
      } else {
        options.history = {base: createBase(base)};
      }
    }
  }
  return curi_createRouter(browser, prepareRoutes(routesConfig), options);
}
