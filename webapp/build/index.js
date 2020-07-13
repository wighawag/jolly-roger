const postcss = require('postcss');
const postCssConfig = require('../postcss.config.js');
const fs = require('fs-extra');
const path = require('path');
const favicons = require('favicons');
const hasha = require('hasha');

function print(message) {
  process.stdout.write(message);
}

/**
 * generate css at exportFolder/_css/global.css using postcss
 * @param {*} exportFolder
 * @param {*} src
 */
function globalCSS(exportFolder, src, config) {
  config = config || {};
  print('bundling css...');
  return new Promise((resolve, reject) => {
    fs.readFile(src, (err, css) => {
      if (err) {
        return reject(err);
      }
      postcss(postCssConfig.plugins)
        .process(css, {from: src})
        .then((result) => {
          let name = 'global';
          if (config.hash) {
            name =
              'global-' +
              hasha(result.css, {algorithm: 'sha1', replace: false}).slice(
                0,
                8
              );
          }
          fs.writeFileSync(
            `${exportFolder}/_css/${name}.css`,
            result.css,
            () => true
          ); // TODO hash
          if (result.map) {
            fs.writeFileSync(
              `${exportFolder}/_css/${name}.css.map`,
              result.map,
              () => true
            ); // TODO hash
          }
          resolve();
        })
        .catch((e) => {
          reject(e);
        });
    });
  }).then(() => {
    print(' done\n');
  });
}

/**
 * clean exportFolder
 * @param {*} exportFolder
 */
function cleanSync(exportFolder) {
  fs.emptyDirSync(exportFolder);
  fs.emptyDirSync(`${exportFolder}/_css`);
  fs.emptyDirSync(`${exportFolder}/_js`);
}

/**
 * copy files into exportFolder
 * @param {*} exportFilder
 * @param {*} files
 */
function copySync(exportFolder, files) {
  if (typeof files === 'string') {
    files = [files];
  }
  for (const file of files) {
    fs.copySync(file, path.join(exportFolder, file)); // TODO hash ?
  }
}

function generateFavicons(exportFolder, icon, config) {
  print('generating favicons...');
  return new Promise((resolve, reject) => {
    favicons(icon, config, async (error, response) => {
      if (error) {
        return reject(error);
      }
      for (const image of response.images) {
        fs.writeFileSync(`${exportFolder}/${image.name}`, image.contents);
      }

      for (const file of response.files) {
        fs.writeFileSync(`${exportFolder}/${file.name}`, file.contents);
      }
      resolve(response.html);
    });
  }).then(() => {
    print(' done\n');
  });
}

const makeHtmlAttributes = (attributes) => {
  if (!attributes) {
    return '';
  }

  const keys = Object.keys(attributes);
  // eslint-disable-next-line no-param-reassign
  return keys.reduce(
    (result, key) => (result += ` ${key}="${attributes[key]}"`),
    ''
  );
};

async function generateBasicIndexHTML(exportFolder, {title, meta}) {
  print('generating html...');
  let template = fs
    .readFileSync(path.resolve(__dirname, 'index.html'))
    .toString();

  const head = template.indexOf('<head>') + 6;
  let inject = '\n';
  if (title) {
    inject += `<title>${title}</title>\n`;
  }
  if (meta) {
    const metas = meta
      .map((input) => {
        const attrs = makeHtmlAttributes(input);
        return `<meta${attrs}>`;
      })
      .join('\n');
    inject += `${metas}\n`;
  }

  const css = fs.readdirSync(path.join(exportFolder, '_css'));
  const links = (css || [])
    .map((fileName) => {
      if (fileName.endsWith('.map')) {
        return '';
      }
      // const attrs = makeHtmlAttributes(attributes.link);
      return `<link href="/_css/${fileName}" rel="stylesheet">`; // ${attrs}
    })
    .join('\n');
  inject += `${links}\n`;

  template = template.slice(0, head) + inject + template.slice(head);

  const body = template.indexOf('<body>') + 6;
  inject = '\n';
  const js = fs.readdirSync(path.join(exportFolder, '_js'));
  const scripts = (js || [])
    .map((fileName) => {
      if (fileName.endsWith('.map')) {
        return '';
      }
      // const attrs = makeHtmlAttributes(attributes.script);
      return `<script src="/_js/${fileName}"></script>`; // ${attrs}
    })
    .join('\n');
  inject += `${scripts}\n`;

  template = template.slice(0, body) + inject + template.slice(body);

  print(' done\n');
  return template;
}

async function generatePages(exportFolder, {pages, faviconsOutput, indexHtml}) {
  print('generating pages...');
  let template = indexHtml;
  const findSrc = 'src="/';
  const reSrc = new RegExp(findSrc, 'g');
  const findHref = 'href="/';
  const reHref = new RegExp(findHref, 'g');
  const findContent = 'content="/';
  const reContent = new RegExp(findContent, 'g');
  const findBuild = '"build/';
  const reBuild = new RegExp(findBuild, 'g');

  const findGeneric = '"/';
  const reGeneric = new RegExp(findGeneric, 'g');

  const head = template.indexOf('<head>') + 6;
  if (faviconsOutput) {
    let favString = '\n';
    for (const faviconHTML of faviconsOutput) {
      favString = favString + faviconHTML + '\n';
    }
    template = template.slice(0, head) + favString + template.slice(head);
  }

  for (const page of pages) {
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
        .replace(reBuild, '"' + baseHref + 'build/')
        .replace(reSrc, 'src="' + baseHref)
        .replace(reSrc, 'src="' + baseHref)
        .replace(reHref, 'href="' + baseHref)
        .replace(reContent, 'content="' + baseHref)
    );
  }

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

function generateCacheURLs(exportFolder, subFolders) {
  let bundleFiles = [];
  for (const subFolder of subFolders) {
    bundleFiles = bundleFiles.concat(
      fs
        .readdirSync(path.join(exportFolder, subFolder))
        .map((v) => `${subFolder}/${v}`)
    );
  }
  return bundleFiles;
}

async function generateServiceWorker(exportFolder, pages) {
  print('generating service worker...');
  const bundleFiles = generateCacheURLs(exportFolder, ['_css', '_js']);
  let sw = fs.readFileSync(path.resolve(__dirname, 'sw.js')).toString();
  sw = sw.replace(
    'URL_TO_CACHE',
    '[' +
      pages
        .map((v) => (v === '' ? `''` : `'${v}/'`))
        .concat(bundleFiles.map((v) => `'${v}'`))
        .join(',') +
      ']'
  );
  fs.writeFileSync(path.join(exportFolder, 'sw.js'), sw);
  print(' done\n');
}

async function ipfsApp(exportFolder, routes) {
  const applicationConfig = JSON.parse(
    fs.readFileSync('./application.json').toString()
  );
  const overrideURL = process.env.APPLICATION_URL;
  if (overrideURL && overrideURL !== '') {
    applicationConfig.url = overrideURL;
  }
  const config = {
    ...applicationConfig,
    pages: routes.map((v) => v.path),
  };
  const title = config.appName + ' - ' + config.appShortDescription;
  const previewURL = config.url + '/' + config.preview;

  if (fs.existsSync('static')) {
    fs.copySync('static', exportFolder);
  }

  let ensName = config.ensName;
  if (ensName && !ensName.endsWith('.eth')) {
    ensName += '.eth';
  }
  if (!ensName && config.url && config.url.endsWith('.eth.link')) {
    ensName = config.url.slice(0, config.url.length - 5);
  }
  if (ensName) {
    if (ensName.startsWith('https://')) {
      ensName = ensName.slice(8);
    }
    if (ensName.startsWith('http://')) {
      ensName = ensName.slice(7);
    }
    fs.writeFileSync(
      path.join(exportFolder, 'robots.txt'),
      'Dwebsite: ' + ensName
    );
  }

  copySync(exportFolder, config.preview);

  const faviconsOutput = await generateFavicons(exportFolder, config.icon, {
    appName: config.appName,
    appShortName: config.appShortName,
    appDescription: config.appDescription,
    developerName: config.developerName,
    developerURL: config.developerURL,
    background: config.background,
    theme_color: config.theme_color,
    appleStatusBarStyle: config.appleStatusBarStyle,
    display: config.display,
    scope: '/',
    start_url: '/', // TODO support (ipfs-gateway-emulator query string) ?homescreen=1'
    // version: pkg.version, // TODO
    logging: false, // TODO ?
    pixel_art: true,
  });

  const indexHtml = await generateBasicIndexHTML(exportFolder, {
    title,
    meta: [
      {charset: 'utf-8'},
      {name: 'viewport', content: 'width=device-width,initial-scale=1'},
      {
        name: 'title',
        content: title,
      },
      {name: 'description', content: config.appDescription},

      {property: 'og:type', content: 'website'},
      {property: 'og:url', content: config.url},
      {property: 'og:title', content: title},
      {
        property: 'og:description',
        content: config.appDescription,
      },
      {
        property: 'og:image',
        content: previewURL,
      },
      {property: 'twitter:card', content: 'summary_large_image'},
      {property: 'twitter:url', content: config.url},
      {
        property: 'twitter:title',
        content: title,
      },
      {
        property: 'twitter:description',
        content: config.appDescription,
      },
      {
        property: 'twitter:image',
        content: previewURL,
      },
    ],
  });
  await generatePages(exportFolder, {
    pages: config.pages,
    indexHtml,
    faviconsOutput,
  });

  await generateServiceWorker(exportFolder, config.pages);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dest = args[0];
  const useHash = args[1]; // TODO
  cleanSync(dest);
  fs.copyFileSync(
    path.resolve(__dirname, 'nollup/index.html'),
    `${dest}/index.html`
  );
  fs.copyFileSync(path.resolve(__dirname, 'nollup/sw.js'), `${dest}/sw.js`);
  globalCSS(dest, 'src/global.css'); // TODO args
} else {
  module.exports = {
    cleanSync,
    globalCSS,
    ipfsApp,
    rollup: {
      clean: (...args) => {
        return {
          async buildStart(inputOptions) {
            // console.log({inputOptions});
            cleanSync(...args);
            // return null; //inputOptions;
          },
        };
      },
      globalCSS: (...args) => {
        return {
          async buildStart(inputOptions) {
            // console.log('css', {inputOptions});
            await globalCSS(...args);
            // return null; // inputOptions;
          },
        };
      },
      ipfsApp: (...args) => {
        return {
          writeBundle() {
            return ipfsApp(...args);
          },
        };
      },
    },
  };
}
