import {prepareRoutes, createRouter, RouterOptions} from '@curi/router';
import {browser, createBase} from '@hickory/browser';

import routes from '../../pages';

const routesConfig = [];
for (const routePath of routes) {
  routesConfig.push({
    name: routePath.name,
    path: !routePath.path || routePath.path == '/' ? '' : routePath.path + '/',
    respond() {
      return {
        body: routePath.component,
      };
    },
  });
}

console.log({routesConfig});

const options: RouterOptions = {};

let base = '';
if (typeof window.basepath !== 'undefined') {
  const count = (window.basepath.match(/\.\./g) || []).length;
  let pathname = location.pathname;
  if (pathname.endsWith('/')) {
    pathname = pathname.slice(0, pathname.length - 1);
  }
  const pathSegments = pathname.split('/');
  base = pathSegments.slice(0, pathSegments.length - count).join('/');
  console.log({base, basepath: window.basepath, pathSegments, count});
  options.history = {base: createBase(base)};
}

export const router = createRouter(browser, prepareRoutes(routesConfig), options);
