import path from 'path';
import fs from 'fs-extra';
import pages from './pages';
import pkg from '../package.json';

function print(message: string) {
  process.stdout.write(message);
}

async function generatePages(exportFolder: string, {pages, indexHtml}: {pages: string[]; indexHtml: string}) {
  print('generating pages and rebasing path relative...');
  const template = indexHtml;
  const findSrc = 'src="/';
  const reSrc = new RegExp(findSrc, 'g');
  const findHref = 'href="/';
  const reHref = new RegExp(findHref, 'g');
  const findContent = 'content="/';
  const reContent = new RegExp(findContent, 'g');
  const findBasepath = 'window.basepath="/';
  const reBasepath = new RegExp(findBasepath, 'g');

  const assets = fs.readdirSync(path.join(exportFolder, '_assets'));
  const findAssetPaths = '"/_assets';
  const reAssetPaths = new RegExp(findAssetPaths, 'g');
  for (const asset of assets) {
    if (asset.endsWith('.js')) {
      const assetPath = path.join(exportFolder, '_assets', asset);
      fs.writeFileSync(
        assetPath,
        fs.readFileSync(assetPath).toString().replace(reAssetPaths, 'window.basepath+"_assets')
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
    fs.ensureDirSync(folderPath);
    fs.writeFileSync(
      indexFilepath,
      template
        .replace(reSrc, 'src="' + baseHref)
        .replace(reSrc, 'src="' + baseHref)
        .replace(reHref, 'href="' + baseHref)
        .replace(reContent, 'content="' + baseHref)
        .replace(reBasepath, 'window.basepath="' + baseHref)
    );
  }

  const findGeneric = '"/';
  const reGeneric = new RegExp(findGeneric, 'g');
  for (const filename of ['yandex-browser-manifest.json', 'manifest.webapp', 'manifest.json', 'browserconfig.xml']) {
    if (filename) {
      const filepath = path.join(exportFolder, filename);
      if (fs.existsSync(filepath)) {
        fs.writeFileSync(filepath, fs.readFileSync(filepath).toString().replace(reGeneric, '"./'));
      }
    }
  }
  print(' done\n');
}

function generateCacheURLs(exportFolder: string, subFolders: string[], filter?: (p: string) => boolean) {
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
  const precache = generateCacheURLs(exportFolder, ['_assets'], (p) => p !== 'index.html' && p !== 'sw.js');
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

  const files = generateCacheURLs(path.join(exportFolder, 'pwa'), [''], (p) => p !== 'index.html' && p !== 'sw.js');
  sw = sw.replace(
    'const URLS_FIXES = [',
    'const URLS_FIXES = [' +
      files
        .filter((p) => p.startsWith('favicon') || p === 'manifest.json') // TODO check which one
        .map((v) => `'pwa/${v}'`)
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
let indexHtml = fs.readFileSync(path.join(exportFolder, 'index.html')).toString();
const pagePaths = pages.map((v) => v.path);
const basePathScript = `
    <script>window.basepath="/";</script>
`;
const redirectScript = `
    <script>
      let newLocation = location.href;
      const pathname = location.pathname;
      if (newLocation.startsWith('http:')) {
        if (!(location.hostname === 'localhost' || (newLocation.endsWith('.link') && location.host.split('.').length > 3))) {
          newLocation = 'https' + newLocation.slice(4);
        }
      }
      if (pathname.endsWith('index.html')) {
        newLocation = newLocation.slice(0, newLocation.length - 10);
      } else if (!pathname.endsWith('/')) {
        newLocation = newLocation + '/';
      }
      if (newLocation !== location.href) {
        console.log("replace : " + location.href + " -> " + newLocation);
        location.replace(newLocation);
      }
    </script>
`;
const head = indexHtml.indexOf('<head>') + 6;
indexHtml = indexHtml.slice(0, head) + `${basePathScript}${redirectScript}` + indexHtml.slice(head);
generatePages(exportFolder, {pages: pagePaths, indexHtml});
generateServiceWorker(exportFolder, pagePaths);
