import path from 'path';
import fs from 'fs-extra';
import favicons, {FavIconResponse, Configuration} from 'favicons';
import pkg from '../package.json';

function print(message: string) {
  process.stdout.write(message);
}
function generateFavicons(exportFolder: string, icon: string, config: Partial<Configuration>): Promise<string[]> {
  print('generating favicons...');
  function generateFav(resolve, reject) {
    favicons(icon, config, async (error: unknown, response: FavIconResponse) => {
      if (error) {
        return reject(error);
      }
      for (const image of response.images) {
        // console.log(`copying ${image.name}...`);
        fs.writeFileSync(`${exportFolder}/${image.name}`, image.contents);
      }

      for (const file of response.files) {
        // console.log(`copying ${file.name}...`);
        fs.writeFileSync(`${exportFolder}/${file.name}`, file.contents);
      }
      resolve(response.html);
    });
  }
  let timer;
  return new Promise<string[]>((resolve, reject) => {
    timer = setTimeout(() => {
      console.log('timed out, retrying...');
      timer = null;
      generateFav(resolve, reject);
    }, 30000);
    generateFav(
      (r) => {
        if (timer) {
          resolve(r);
        }
      },
      (e) => {
        if (timer) {
          reject(e);
        }
      }
    );
  }).then((r) => {
    print(' done\n');
    clearTimeout(timer);
    return r;
  });
}

const makeHtmlAttributes = (attributes: {[key: string]: string}) => {
  if (!attributes) {
    return '';
  }

  const keys = Object.keys(attributes);
  // eslint-disable-next-line no-param-reassign
  return keys.reduce((result, key) => (result += ` ${key}="${attributes[key]}"`), '');
};

async function generateBasicIndexHTML(
  folder: string,
  {title, meta, faviconsOutput}: {title: string; meta: {[key: string]: string}[]; faviconsOutput: string[]}
) {
  print('generating html...');
  let template = fs.readFileSync('index.template.html').toString();

  const head = template.indexOf('<head>') + 6;
  let inject = '\n';
  if (title) {
    inject += `    <title>${title}</title>\n`;
  }
  if (meta) {
    const metas = meta
      .map((input) => {
        const attrs = makeHtmlAttributes(input);
        return `    <meta${attrs}>`;
      })
      .join('\n');
    inject += `${metas}\n`;
  }

  inject += '\n';
  for (const faviconHTML of faviconsOutput) {
    inject = inject + '    ' + faviconHTML + '\n';
  }

  template = template.slice(0, head) + inject + template.slice(head);

  fs.writeFileSync(path.join(folder, 'index.html'), template);
  print(' done\n');
}

function replaceRootPaths(folder: string, files: string[]) {
  const findSrc = 'src="/';
  const reSrc = new RegExp(findSrc, 'g');
  const findDirect = '"/';
  const reDirect = new RegExp(findDirect, 'g');
  for (const file of files) {
    const filepath = path.join(folder, file);
    if (fs.existsSync(filepath)) {
      let content = fs.readFileSync(filepath).toString();
      if (file.endsWith('.html') || file.endsWith('.xml')) {
        content = content.replace(reSrc, 'src="../');
      } else {
        content = content.replace(reDirect, '"../');
      }
      fs.writeFileSync(filepath, content);
    }
  }
}

const CACHE_FILE = 'node_modules/.favicons_cache';

async function generateApp(publicFolder: string) {
  const now = Math.floor(Date.now() / 1000);
  const config = JSON.parse(fs.readFileSync('./application.json').toString());
  const sources = ['./application.json', 'index.template.html'];
  if (config.icon) {
    sources.push(config.icon);
  }
  if (config.maskable_icon) {
    sources.push(path.join(publicFolder, 'pwa', config.maskable_icon));
  }
  const maxTime = Math.max(
    ...sources.map((v) => {
      try {
        return fs.statSync(v).mtime.getTime();
      } catch (e) {
        return Date.now();
      }
    })
  );
  let lastTime = 0;
  try {
    lastTime = fs.statSync(CACHE_FILE).mtime.getTime();
  } catch (e) {}
  if (lastTime >= maxTime) {
    return;
  }
  const overrideURL = process.env.APPLICATION_URL;
  if (overrideURL && overrideURL !== '') {
    config.url = overrideURL;
  }
  const title = config.appName + ' - ' + config.appShortDescription;
  const previewURL = config.url + '/' + (config.preview || 'preview.png');

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
    fs.writeFileSync(path.join(publicFolder, 'robots.txt'), 'Dwebsite: ' + ensName);
  }

  const faviconFolder = path.join(publicFolder, 'pwa');
  fs.ensureDirSync(faviconFolder);
  const faviconsOutput = await generateFavicons(faviconFolder, config.icon, {
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
    start_url: '/',
    version: pkg.version,
    logging: false,
    pixel_art: true,
    path: '/pwa/',
  });

  if (config.maskable_icon) {
    const maskableIconPath = path.join(faviconFolder, config.maskable_icon);
    if (fs.existsSync(maskableIconPath)) {
      const manifestPath = path.join(faviconFolder, 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath).toString());
        let found = false;
        for (const icon of manifest.icons) {
          if (icon.src.endsWith(`/${config.maskable_icon}`)) {
            icon.purpose = 'any maskable';
            found = true;
          }
        }
        if (found) {
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '  '));
        } else {
          console.error(`maskable icon file ("${maskableIconPath}") not found in manifest`);
        }
      } catch (e) {
        console.error(`failed to setup maskable icon file ("${maskableIconPath}")`, e);
      }
    } else {
      console.warn(`maskable icon file ("${maskableIconPath}") does not exist`);
    }
  }

  replaceRootPaths(faviconFolder, [
    'manifest.json',
    'yandex-browser-manifest.json',
    'manifest.webapp',
    'browserconfig.xml',
  ]);

  await generateBasicIndexHTML('', {
    title,
    faviconsOutput,
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

  for (const source of sources) {
    try {
      fs.utimesSync(source, now, now);
    } catch (e) {}
  }

  fs.writeFileSync(CACHE_FILE, Date.now().toString());
  fs.utimesSync(CACHE_FILE, now, now);
}

generateApp('public');
