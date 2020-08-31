// /!\ Warning /!\
// Variables auto updated by build:
const URLS_FIXES = []; // issues with sub folder and favicon / manifest request
const URLS_TO_PRE_CACHE = [];
const CACHE_NAME = 'cache-v1';
const DEV = true;
//////////////////////////////////////////////////////////////////////////////

const href = self.location.href;
const pathname = self.location.pathname;
const baseurl = `${href.slice(0, href.length - 5)}`; // assume service worker is named `sw.js`
const base = pathname.substr(0, pathname.length - 5); // assume service worker is named `sw.js`

const urlFixes = URLS_FIXES;
const urlsToPreCache = URLS_TO_PRE_CACHE.map((v) => base + v);

// Regexes are sorted by priority

const regexesOnlineFirst = [];
if (DEV) {
  regexesOnlineFirst.push('localhost');
}

const regexesOnlineOnly = [];

const regexesCacheFirst = [self.location.origin, 'https://rsms.me/inter/', 'cdn'];

const regexesCacheOnly = [];

// If the url doesn't match any of those regexes, it will do online first

console.log(`[Service Worker] Origin: ${self.location.origin}`);

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log(`[Service Worker] Creating cache: ${CACHE_NAME}`);
        return cache.addAll(urlsToPreCache);
      })
      .then(() => {
        self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((thisCacheName) => {
          if (thisCacheName !== CACHE_NAME) {
            console.log(`[Service Worker] Deleting: ${thisCacheName}`);
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
        if (request.method === 'GET') {
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
    console.log(`[Service Worker] Cache first: ${request.url}`);
    const fun = update(request, cache);
    return cache || fun;
  },
  regexes: regexesCacheFirst,
};

const cacheOnly = {
  method: (request, cache) => {
    console.log(`[Service Worker] Cache only: ${request.url}`);
    return cache || update(request, cache);
  },
  regexes: regexesCacheOnly,
};

const onlineFirst = {
  method: (request, cache) => {
    console.log(`[Service Worker] Online first: ${request.url}`);
    return update(request, cache);
  },
  regexes: regexesOnlineFirst,
};

const onlineOnly = {
  method: (request) => {
    console.log(`[Service Worker] Online only: ${request.url}`);
    return fetch(request);
  },
  regexes: regexesOnlineOnly,
};

self.addEventListener('fetch', (event) => {
  let request = event.request;
  for (const urlFix of urlFixes) {
    if (request.url.endsWith(`/${urlFix}`)) {
      const newUrl = `${baseurl}${urlFix}`;
      if (newUrl !== request.url) {
        console.log('url fix found', {urlFix, newUrl, oldUrl: request.url});
        request = new Request(newUrl);
      }
      break;
    }
  }

  event.respondWith(
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
