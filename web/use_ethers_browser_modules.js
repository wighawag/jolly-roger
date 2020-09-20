/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

function fix(folderPath, moduleName) {
  const modulePath = path.join(folderPath, moduleName);
  if (moduleName.startsWith('@ethersproject')) {
    try {
      const pkgPath = path.join(modulePath, 'package.json');

      const pkg = JSON.parse(fs.readFileSync(pkgPath));
      const browserModulePath = pkg['browser.esm'];
      let changed = false;
      if (typeof browserModulePath === 'string') {
        pkg.module = browserModulePath;
        changed = true;
      } else if (typeof browserModulePath === 'object') {
        pkg.browser = browserModulePath;
        changed = true;
      }
      if (changed) {
        console.log(`${pkgPath}...`);
        console.log({module: pkg.module, browser: pkg.browser});
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '  '));
      }
    } catch (e) {}
  }
  const furtherNodeModules = path.join(modulePath, 'node_modules');
  if (fs.existsSync(furtherNodeModules)) {
    recurse(furtherNodeModules);
  }
}

function recurse(folderPath) {
  if (fs.existsSync(folderPath)) {
    const moduleFolders = fs.readdirSync(folderPath);
    for (const moduleFolder of moduleFolders) {
      if (moduleFolder.startsWith('@')) {
        const moduleSubFolders = fs.readdirSync(path.join(folderPath, moduleFolder));
        for (const moduleSubFolder of moduleSubFolders) {
          fix(folderPath, path.join(moduleFolder, moduleSubFolder));
        }
      } else {
        fix(folderPath, moduleFolder);
      }
    }
  }
}

recurse('node_modules');
recurse('node_modules/.pnpm');
