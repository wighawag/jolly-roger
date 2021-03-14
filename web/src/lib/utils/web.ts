/* eslint-disable @typescript-eslint/no-explicit-any */
export function getParamsFromURL(str?: string): Record<string, string> {
  const url = str || window.location.href;
  const obj: Record<string, string> = {};
  const hash = url.lastIndexOf('#');

  let cleanedUrl = url;
  if (hash !== -1) {
    cleanedUrl = cleanedUrl.slice(0, hash);
  }

  const question = cleanedUrl.indexOf('?');
  if (question !== -1) {
    cleanedUrl
      .slice(question + 1)
      .split('&')
      .forEach((piece) => {
        const [key, val = ''] = piece.split('=');
        obj[decodeURIComponent(key)] = decodeURIComponent(val);
      });
  }
  return obj;
}

export function getParamsFromURLHash(str?: string): Record<string, string> {
  const url = str || window.location.hash;
  const obj: Record<string, string> = {};
  const hash = url.lastIndexOf('#');

  if (hash !== -1) {
    url
      .slice(hash + 1)
      .split('&')
      .forEach((piece) => {
        const [key, val = ''] = piece.split('=');
        obj[decodeURIComponent(key)] = decodeURIComponent(val);
      });
  }
  return obj;
}

export function rebuildLocationHash(hashParams: Record<string, string>): void {
  let reconstructedHash = '';
  Object.entries(hashParams).forEach((param) => {
    if (reconstructedHash === '') {
      reconstructedHash += '#';
    } else {
      reconstructedHash += '&';
    }
    reconstructedHash += param.join('=');
  });

  if ('replaceState' in window.history) {
    window.history.replaceState(
      '',
      document.title,
      window.location.pathname + window.location.search + reconstructedHash
    );
  } else {
    // Prevent scrolling by storing the page's current scroll offset
    const {scrollTop, scrollLeft} = document.body;
    window.location.hash = '';

    // Restore the scroll offset, should be flicker free
    document.body.scrollTop = scrollTop;
    document.body.scrollLeft = scrollLeft;
  }
}

async function chrome76Detection(): Promise<boolean> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const {quota} = await navigator.storage.estimate();
    return quota !== undefined && quota < 120000000;
  }
  return false;
}

function isNewChrome(): boolean {
  const pieces = navigator.userAgent.match(
    /Chrom(?:e|ium)\/([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)/
  );
  if (pieces === null || pieces.length !== 5) {
    return false;
  }
  const major = pieces.map((piece) => parseInt(piece, 10))[1];
  return major >= 76;
}

export function isPrivateWindow(): Promise<boolean | null> {
  return new Promise((resolve) => {
    try {
      const isSafari =
        navigator.vendor &&
        navigator.vendor.indexOf('Apple') > -1 &&
        navigator.userAgent &&
        navigator.userAgent.indexOf('CriOS') === -1 &&
        navigator.userAgent.indexOf('FxiOS') === -1;

      if (isSafari) {
        // Safari
        let e = false;
        if ((window as any).safariIncognito) {
          e = true;
        } else {
          try {
            (window as any).openDatabase(null, null, null, null);
            window.localStorage.setItem('test', '1');
            resolve(false);
          } catch (err) {
            e = true;
            resolve(true);
          }
          // eslint-disable-next-line no-unused-expressions, no-void
          void !e && ((e = !1), window.localStorage.removeItem('test'));
        }
      } else if (navigator.userAgent.includes('Firefox')) {
        // Firefox
        const db = indexedDB.open('test');
        db.onerror = () => {
          resolve(true);
        };
        db.onsuccess = () => {
          resolve(false);
        };
      } else if (
        navigator.userAgent.includes('Edge') ||
        navigator.userAgent.includes('Trident') ||
        navigator.userAgent.includes('msie')
      ) {
        // Edge or IE
        if (
          !window.indexedDB &&
          (window.PointerEvent || window.MSPointerEvent)
        ) {
          resolve(true);
        }
        resolve(false);
      } else {
        // Normally ORP or Chrome
        if (isNewChrome()) {
          resolve(chrome76Detection());
        }

        const fs =
          (window as any).RequestFileSystem ||
          (window as any).webkitRequestFileSystem;
        if (!fs) {
          resolve(null);
        } else {
          fs(
            (window as any).TEMPORARY,
            100,
            () => resolve(false),
            () => resolve(true)
          );
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      resolve(null);
    }
  });
}
