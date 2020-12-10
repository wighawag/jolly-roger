/* eslint-disable no-useless-escape */
import path from 'path';
import fs from 'fs-extra';
import pages from './pages';
import pkg from '../package.json';
import namehash from 'eth-ens-namehash';

function print(message: string) {
  process.stdout.write(message);
}

function insertTopOfHead(indexHtml: string, content: string): string {
  const head = indexHtml.indexOf('<head>') + 6;
  indexHtml = indexHtml.slice(0, head) + content + indexHtml.slice(head);
  return indexHtml;
}

async function generatePages(
  exportFolder: string,
  {
    pages,
    indexHtml,
    useBaseElem,
  }: {pages: string[]; indexHtml: string; useBaseElem: boolean}
) {
  print('generating pages and rebasing path relative...');
  const template = indexHtml;
  const findSrc = 'src="/';
  const reSrc = new RegExp(findSrc, 'g');
  const findHref = 'href="/';
  const reHref = new RegExp(findHref, 'g');
  const findContent = 'content="/';
  const reContent = new RegExp(findContent, 'g');
  const findRelpath = 'window.relpath="/';
  const reRelpath = new RegExp(findRelpath, 'g');

  const assets = fs.readdirSync(path.join(exportFolder, '_assets'));
  const findAssetPaths = '"/_assets';
  const reAssetPaths = new RegExp(findAssetPaths, 'g');
  for (const asset of assets) {
    if (asset.endsWith('.js')) {
      const assetPath = path.join(exportFolder, '_assets', asset);
      fs.writeFileSync(
        assetPath,
        fs
          .readFileSync(assetPath)
          .toString()
          .replace(reAssetPaths, 'window.basepath+"_assets')
      );
    }
  }

  for (const page of pages) {
    if (page.endsWith('.*')) {
      continue;
    }
    const folderPath = path.join(exportFolder, page);
    const indexFilepath = path.join(folderPath, 'index.html');
    // console.log({indexFilepath});
    const numSlashes = page.split('/').length - 1;
    let baseHref = '';
    if (page != '') {
      baseHref = '../';
      for (let i = 0; i < numSlashes; i++) {
        baseHref += '../';
      }
    }

    let indexHtml = template;

    let srcBaseHref = baseHref;
    if (useBaseElem) {
      if (baseHref !== '') {
        const baseElem = `
    <base href="${baseHref}">
`;
        indexHtml = insertTopOfHead(indexHtml, baseElem);
      }
      srcBaseHref = '';
    }

    indexHtml = indexHtml
      .replace(reSrc, 'src="' + srcBaseHref)
      .replace(reSrc, 'src="' + srcBaseHref)
      .replace(reHref, 'href="' + srcBaseHref)
      .replace(reContent, 'content="' + srcBaseHref);

    indexHtml = indexHtml.replace(reRelpath, 'window.relpath="' + baseHref);

    const debugScripts = `
    <script>
      (function () {
        if (!!/\\?_d_eruda/.test(window.location) || !!/&_d_eruda/.test(window.location)) {
          var src = '${srcBaseHref}scripts/eruda.js';
          window._debug = true;
          document.write('<scr' + 'ipt src="' + src + '"></scr' + 'ipt>');
          document.write('<scr' + 'ipt>eruda.init();</scr' + 'ipt>');
        }
      })();
    </script>
`;
    indexHtml = insertTopOfHead(indexHtml, debugScripts);

    fs.ensureDirSync(folderPath);
    fs.writeFileSync(indexFilepath, indexHtml);
  }

  const findGeneric = '"/';
  const reGeneric = new RegExp(findGeneric, 'g');
  for (const filename of [
    'yandex-browser-manifest.json',
    'manifest.webapp',
    'manifest.json',
    'browserconfig.xml',
  ]) {
    if (filename) {
      const filepath = path.join(exportFolder, filename);
      if (fs.existsSync(filepath)) {
        fs.writeFileSync(
          filepath,
          fs.readFileSync(filepath).toString().replace(reGeneric, '"./')
        );
      }
    }
  }
  print(' done\n');
}

function generateCacheURLs(
  exportFolder: string,
  subFolders: string[],
  filter?: (p: string) => boolean
) {
  if (!filter) {
    filter = () => true;
  }
  let bundleFiles: string[] = [];
  for (const subFolder of subFolders) {
    bundleFiles = bundleFiles.concat(
      fs
        .readdirSync(path.join(exportFolder, subFolder))
        .filter(filter)
        .map((v) => `${subFolder}${subFolder !== '' ? '/' : ''}${v}`)
    );
  }
  return bundleFiles;
}

function generateServiceWorker(exportFolder: string, pages: string[]) {
  print('generating service worker...');
  const precache = generateCacheURLs(
    exportFolder,
    ['_assets'],
    (p) => p !== 'index.html' && p !== 'sw.js'
  );
  let sw = fs.readFileSync(path.join(exportFolder, 'sw.js')).toString();
  sw = sw.replace(
    'const URLS_TO_PRE_CACHE = [',
    'const URLS_TO_PRE_CACHE = [' +
      pages
        .filter((v) => !v.endsWith('.*'))
        .map((v) => (v === '' ? `''` : `'${v}/'`))
        .concat(precache.map((v) => `'${v}'`))
        .join(', ') +
      ','
  );

  sw = sw.replace(
    `const CACHE_NAME = 'cache-v1';`,
    `const CACHE_NAME = 'cache-${pkg.name}-${(+new Date()).toString(36)}';`
  );

  sw = sw.replace(`const DEV = true;`, `const DEV = false;`);

  fs.writeFileSync(path.join(exportFolder, 'sw.js'), sw);
  print(' done\n');
}

const exportFolder = 'dist';
let indexHtml = fs
  .readFileSync(path.join(exportFolder, 'index.html'))
  .toString();
const pagePaths = pages.map((v) => v.path);

const basePathScript = `
    <script>
      window.relpath="/";
      const count = (window.relpath.match(/\.\./g) || []).length;
      let lPathname = location.pathname;
      if (lPathname.endsWith('/')) {
        lPathname = lPathname.slice(0, lPathname.length - 1);
      }
      const pathSegments = lPathname.split('/');
      window.basepath = pathSegments.slice(0, pathSegments.length - count).join('/');
      if (!window.basepath.endsWith('/')) {
        window.basepath += '/';
      }
    </script>
`;

let redirectEthLink = '';
let config;
try {
  config = JSON.parse(fs.readFileSync('./application.json').toString());
} catch (e) {}
if (config && config.ensName && config.ethLinkErrorRedirect) {
  indexHtml = indexHtml.replace(
    /(="\/_assets\/.*")/g,
    '$1 onerror="window.onFailingResource()"'
  );
  const handleEthLink = `
      function loadAlert() {
        return new Promise((resolve) => {
          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.src = window.basepath + "scripts/asteroid-alert.js";
          script.onload = script.onreadystatechange = function () {
            resolve(window.$alert);
          };
          script.onerror = function () {
            resolve((msg) => new Promise((resolve) => {window.alert(msg); resolve();}));
          };
          document.head.appendChild(script);
        });
      }
      if(location.hostname.endsWith('eth.link') && location.search.indexOf("noipfsredirect=true") === -1) {
        window.onFailingResource = () => {
          redirectToIPFS().then((url) => {
            loadAlert().then((alert) => alert("The ENS 'eth.link' service is having caching issues causing the website to misbehave.\\nThis usually happen when the website is updated to a new ipfs hash and eth.link is catching up.\\nWe will redirect you to an ipfs gateway in the mean time:\\nSorry for the inconvenience."))
            .then(() => location.assign(url + location.pathname + location.search + location.hash))
          });
        };
      } else {
        window.onFailingResource = () => {console.error("resource failed to load");};
      }
`;
  if (config.ethLinkErrorRedirect === 'hash') {
    const hash = namehash.hash(config.ensName).slice(2);
    // NOTE: This assumes the default public resolver is used
    redirectEthLink = `
      function redirectToIPFS() {
        return fetch("https://mainnet.infura.io/v3/bc0bdd4eaac640278cdebc3aa91fabe4", {method: "POST", body: JSON.stringify({jsonrpc: "2.0", id: "3", method: "eth_call", params:[{to:"0x4976fb03c32e5b8cfe2b6ccb31c09ba78ebaba41", data:"0xbc1c58d1${hash}"}, "latest"]})}).then(v=>v.json()).then((json) => {
          const result = json.result;
          const hash = result && result.slice(130, 134).toLowerCase() === 'e301' && result.slice(134, 206);
          if (hash) {
            const a = 'abcdefghijklmnopqrstuvwxyz234567';
            const h = new Uint8Array(hash.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
            const l = 36;
            let b = 0;
            let v = 0;
            let o = '';
            for (let i = 0; i < l; i++) {
              v = (v << 8) | h[i];
              b += 8;
              while (b >= 5) {
                o += a[(v >>> (b - 5)) & 31];
                b -= 5;
              }
            }
            if (b > 0) {
              o += a[(v << (5 - b)) & 31];
            }
            const url = 'https://b' + o + '.ipfs.dweb.link';
            return url;
          }
        }).catch((e) => console.error(e));
      }
      ${handleEthLink}
`;
  } else if (config.ethLinkErrorRedirect === 'ipns') {
    redirectEthLink = `
    function redirectToIPFS() {
      return new Promise((resolve) => {
        const url = 'https://ipfs.io/ipns/${config.ensName}';
        resolve(url);
      });
    }
    ${handleEthLink}
`;
  }
}
const redirectScript = `
    <script>
      let newLocation = location.href;
      if (newLocation.startsWith('http:')) {
        if (!(location.hostname === 'localhost' || location.hostname.startsWith('192.') || location.hostname.endsWith('test.eth.link') || (newLocation.endsWith('.eth.link') && location.host.split('.').length > 3))) {
          newLocation = 'https' + newLocation.slice(4);
        }
      }
      const pathname = location.pathname;
      if (pathname.endsWith('index.html')) {
        newLocation = newLocation.slice(0, newLocation.length - 10);
      } else if (!pathname.endsWith('/')) {
        newLocation = newLocation + '/';
      }
      if (newLocation !== location.href) {
        console.log("replace : " + location.href + " -> " + newLocation);
        location.replace(newLocation);
      } else {${redirectEthLink}}
    </script>
`;

const linkReloadScript = `
    <script>
      // ensure we save href as they are loaded, so they do not change on page navigation
      document.querySelectorAll("link[href]").forEach((v) => v.href = v.href);
    </script>
`;

const headStart = indexHtml.indexOf('<head>') + 6;
indexHtml =
  indexHtml.slice(0, headStart) +
  `${basePathScript}${redirectScript}` +
  indexHtml.slice(headStart);
const headEnd = indexHtml.indexOf('</head>');
indexHtml =
  indexHtml.slice(0, headEnd) +
  `${linkReloadScript}` +
  indexHtml.slice(headEnd);

generatePages(exportFolder, {
  pages: pagePaths,
  indexHtml,
  useBaseElem: false,
});
generateServiceWorker(exportFolder, pagePaths);
