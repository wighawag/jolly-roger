// self.skipWaiting(); // force removal of old instantly
var pathname = self.location.pathname;
var base = pathname.substr(0, pathname.length - 5); // remove : /sw.js
var CACHE_NAME = 'cache-v1';
var urlsToCache = URL_TO_CACHE.map((v) => base + v);

self.addEventListener('install', function (event) {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      console.log('Opened cache');
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', function (event) {
  event.respondWith(
    caches.match(event.request).then(function (response) {
      // Cache hit - return response
      if (response) {
        return response;
      }
      return fetch(event.request);
    })
  );
});

self.addEventListener('activate', function (event) {
  // delete old caches when updating if needed
  // var cacheWhitelist = ['pages-cache-v1', 'blog-posts-cache-v1'];
  // event.waitUntil(
  //   caches.keys().then(function(cacheNames) {
  //     return Promise.all(
  //       cacheNames.map(function(cacheName) {
  //         if (cacheWhitelist.indexOf(cacheName) === -1) {
  //           return caches.delete(cacheName);
  //         }
  //       })
  //     );
  //   })
  // );
});
