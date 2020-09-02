import {logs} from 'named-logs-console';
import {updateAvailable} from './stores/appUpdates';

const log = logs('sw.js');
function updateLoggingForWorker(worker) {
  if (worker) {
    worker.postMessage({type: 'debug', level: log.level, enabled: log.enabled});
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    // if (process.env.NODE_ENV === 'production') {
    const swLocation = `${typeof window.basepath === 'undefined' ? '/' : window.basepath}sw.js`;
    console.log({swLocation});
    navigator.serviceWorker.register(swLocation).then((registration) => {
      updateLoggingForWorker(registration.installing);
      updateLoggingForWorker(registration.waiting);
      updateLoggingForWorker(registration.active);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[Service Worker] Update found');
            updateAvailable.set(true);
          }
        });
      });
    });
    // TODO ?
    // } else {
    //   navigator.serviceWorker
    //     .getRegistrations()
    //     .then((registrations) => {
    //       registrations.forEach((registration) => {
    //         registration.unregister();
    //       });
    //       return registrations.length;
    //     })
    //     .then((len) => {
    //       len > 0 && location.reload();
    //     });
    // }
  });
}
