import {prepareRoutes, createRouter, announce} from '@curi/router';
import {browser, createBase} from '@hickory/browser';

// TODO generate from pages folder
import routeComponents from './pages/index.js';
import basicRoutes from './routes';
const routes = [];
for (const basicRoute of basicRoutes) {
  routes.push({...basicRoute, component: routeComponents[basicRoute.name]});
}

let counter = 0;
function redirect({name, path}) {
  return {
    name: name + 'Redirect' + counter++,
    path,
    respond({match}) {
      return {
        redirect: {name},
      };
    },
  };
}

function route({name, path, component}) {
  return {
    name,
    path,
    respond({match}) {
      // redirect to trailing slash (in case server does not) // not used as we use redirect function (pattern matching not working)
      const pathname = match.location.pathname;
      if (!pathname.endsWith('index.html') && !pathname.endsWith('/')) {
        return {
          redirect: {name},
        };
      }
      return {
        body: component,
      };
    },
  };
}

// IPFS support : redirect on non-slash and /index.html paths
function generateRoutes(routePaths) {
  let basepath = undefined;
  const pathname = typeof location !== 'undefined' ? location.pathname : '';
  const routesConfig = [];
  for (const routePath of routePaths) {
    if (routePath.path) {
      routesConfig.push(
        route({
          name: routePath.name,
          path: routePath.path + '/',
          component: routePath.component,
        })
      );
    }
    routesConfig.push(
      redirect({
        name: routePath.name,
        path: routePath.path ? routePath.path + '/index.html' : 'index.html',
      })
    );
    if (routePath.path) {
      routesConfig.push(
        redirect({
          name: routePath.name,
          path: routePath.path,
        })
      );
    } else {
      routesConfig.push(
        route({
          name: routePath.name,
          path: routePath.path,
          component: routePath.component,
        })
      );
    }

    const regexStr = '(/.*)/?' + routePath.path;
    const regex = new RegExp(regexStr);
    const result = regex.exec(pathname);
    if (result && result[1]) {
      let match = result[1];
      // console.log({regexStr, match});
      if (match.endsWith('/')) {
        match = match.substr(0, match.length - 1);
      }
      if (basepath === undefined || basepath.length > match.length) {
        basepath = match;
      }
    }
  }
  routesConfig.push({
    name: 'NotFound',
    path: '.*',
    respond({match}) {
      console.log('NotFound', arguments);
      return {
        body: Index, // TODO
      };
    },
  });
  if (basepath.endsWith('index.html')) {
    basepath = basepath.slice(0, basepath.length - 11);
  }
  return {basepath, routesConfig};
}

const {routesConfig, basepath} = generateRoutes(routes);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register(`${basepath}/sw.js`).then(
      function (registration) {
        // Registration was successful
      },
      function (err) {
        // registration failed :(
      }
    );
  });
}

const options = {};

if (basepath) {
  options.history = {base: createBase(basepath)};
}

export const router = createRouter(
  browser,
  prepareRoutes(routesConfig),
  options
);
