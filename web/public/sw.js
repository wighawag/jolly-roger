// /!\ Warning /!\
// Variables auto updated by build:
const URLS_TO_PRE_CACHE = [];
const CACHE_NAME = 'cache-name';
const DEV = true;
//////////////////////////////////////////////////////////////////////////////

let _logEnabled = false;
function log(...args) {
  if (_logEnabled) {
    console.debug(...args);
  }
}
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'debug') {
    _logEnabled = event.data.enabled && event.data.level >= 5;
  }
});

const pathname = self.location.pathname;
const base = pathname.substr(0, pathname.length - 5); // assume service worker is named `sw.js`

const urlsToPreCache = URLS_TO_PRE_CACHE.map((v) => base + v);

// Regexes are sorted by priority

const regexesOnlineFirst = [];
if (DEV) {
  regexesOnlineFirst.push('localhost');
}

const regexesOnlineOnly = [];

const regexesCacheFirst = [
  self.location.origin,
  'https://rsms.me/inter/',
  'cdn',
];

const regexesCacheOnly = [];

// If the url doesn't match any of those regexes, it will do online first

log(`[Service Worker] Origin: ${self.location.origin}`);

self.addEventListener('install', (event) => {
  log('[Service Worker] Install');
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        log(`[Service Worker] Creating cache: ${CACHE_NAME}`);
        return cache.addAll(urlsToPreCache);
      })
      .then(() => {
        self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
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
      ).then(() => self.clients.claim());
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

self.addEventListener('fetch', (event) => {
  let request = event.request;
  event.respondWith(
    // TODO remove query param from matching, query param are used as config (why not use hashes then ?) const normalizedUrl = normalizeUrl(event.request.url);
    caches.match(request).then((cache) => {
      // The order matters !
      const patterns = [onlineFirst, onlineOnly, cacheFirst, cacheOnly];

      for (let pattern of patterns) {
        for (let regex of pattern.regexes) {
          if (RegExp(regex).test(request.url)) {
            return pattern.method(request, cache);
          }
        }
      }

      return onlineFirst.method(request, cache);
    })
  );
});
