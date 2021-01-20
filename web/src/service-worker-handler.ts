import {logs} from 'named-logs-console';
import {updateAvailable} from './stores/appUpdates';

const log = logs('sw.js');
function updateLoggingForWorker(worker: ServiceWorker | null) {
  if (worker) {
    worker.postMessage({type: 'debug', level: log.level, enabled: log.enabled});
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    const base = typeof window.basepath === 'undefined' ? '/' : window.basepath;
    const swLocation = `${base}sw.js`;
    //{scope: base}
    navigator.serviceWorker
      .register(swLocation)
      .then((registration) => {
        updateLoggingForWorker(registration.installing);
        updateLoggingForWorker(registration.waiting);
        updateLoggingForWorker(registration.active);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (worker) {
            worker.addEventListener('statechange', () => {
              if (
                worker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                console.log('[Service Worker] Update found');
                updateAvailable.set(true);
              }
            });
          }
        });
      })
      .catch((e) => {
        console.log(e);
        // console.error('Failed to register service worker', e);
      });
  });
}
