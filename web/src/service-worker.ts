import {build, timestamp} from '$service-worker';

///////////////////////////////////////////////////////////////////////////////
const URLS_TO_PRE_CACHE = build.concat(['_INJECT_PAGES_']);
const CACHE_NAME = 'cache-name' + timestamp;
const DEV = true;
//////////////////////////////////////////////////////////////////////////////

let _logEnabled = true; // TODO false
function log(...args) {
  if (_logEnabled) {
    console.debug(...args);
  }
}

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'debug') {
    _logEnabled = event.data.enabled && event.data.level >= 5;
  } else if (event.data === 'skipWaiting') {
    log(`skipWaiting received`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).skipWaiting();
  }
});

const pathname = self.location.pathname;
const base = pathname.substr(0, pathname.length - 18); // assume service worker is named `service-worker.js` // name's length = 17

const urlsToPreCache = URLS_TO_PRE_CACHE.map((v) => base + v);

const regexesOnlineFirst = [];
if (DEV) {
  regexesOnlineFirst.push('localhost');
}

const regexesOnlineOnly = [];

const regexesCacheFirst = [self.location.origin, 'https://rsms.me/inter/', 'cdn', '.*\\.png$', '.*\\.svg$'];

const regexesCacheOnly = [];

// If the url doesn't match any of those regexes, it will do online first

log(`[Service Worker] Origin: ${self.location.origin}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.addEventListener('install', (event: any) => {
  log('[Service Worker] Install');
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        log(`[Service Worker] Creating cache: ${CACHE_NAME}`);
        return cache.addAll(urlsToPreCache);
      })
      .then(() => {
        // (self as any).skipWaiting();
        log(`cache fully fetched!`);
      })
  );
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.addEventListener('activate', (event: any) => {
  log('[Service Worker] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((thisCacheName) => {
          if (thisCacheName !== CACHE_NAME) {
            log(`[Service Worker] Deleting: ${thisCacheName}`);
            return caches.delete(thisCacheName);
          }
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ).then(() => (self as any).clients.claim());
    })
  );
});

const update = (request, cache) => {
  return fetch(request)
    .then((response) => {
      return caches.open(CACHE_NAME).then((cache) => {
        if (request.method === 'GET' && request.url.startsWith('http')) {
          // only on http protocol to prevent chrome-extension request to error out
          cache.put(request, response.clone());
        }
        return response;
      });
    })
    .catch(() => {
      return cache;
    });
};

const cacheFirst = {
  method: (request, cache) => {
    log(`[Service Worker] Cache first: ${request.url}`);
    const fun = update(request, cache);
    return cache || fun;
  },
  regexes: regexesCacheFirst,
};

const cacheOnly = {
  method: (request, cache) => {
    log(`[Service Worker] Cache only: ${request.url}`);
    return cache || update(request, cache);
  },
  regexes: regexesCacheOnly,
};

const onlineFirst = {
  method: (request, cache) => {
    log(`[Service Worker] Online first: ${request.url}`);
    return update(request, cache);
  },
  regexes: regexesOnlineFirst,
};

const onlineOnly = {
  method: (request) => {
    log(`[Service Worker] Online only: ${request.url}`);
    return fetch(request);
  },
  regexes: regexesOnlineOnly,
};

async function getResponse(event: {request: Request}): Promise<Response> {
  const request = event.request;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registration = (self as any).registration as ServiceWorkerRegistration;
  if (
    event.request.mode === 'navigate' &&
    event.request.method === 'GET' &&
    registration.waiting &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await (self as any).clients.matchAll()).length < 2
  ) {
    log('only one client, skipWaiting as we navigate the page');
    registration.waiting.postMessage('skipWaiting');
    const response = new Response('', {headers: {Refresh: '0'}});
    return response;
  }

  // TODO remove query param from matching, query param are used as config (why not use hashes then ?) const normalizedUrl = normalizeUrl(event.request.url);
  const response = await caches.match(request).then((cache) => {
    // The order matters !
    const patterns = [onlineFirst, onlineOnly, cacheFirst, cacheOnly];

    for (const pattern of patterns) {
      for (const regex of pattern.regexes) {
        if (RegExp(regex).test(request.url)) {
          return pattern.method(request, cache);
        }
      }
    }

    return onlineFirst.method(request, cache);
  });
  return response;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.addEventListener('fetch', (event: any) => {
  event.respondWith(getResponse(event));
});
