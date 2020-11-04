/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

function fix(pkgPath) {
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
}

function recurse(folderPath) {
  if (fs.existsSync(folderPath)) {
    const subFolders = fs.readdirSync(folderPath);
    for (const subFolder of subFolders) {
      const subFolderPath = path.join(folderPath, subFolder);
      let stats;
      try {
        stats = fs.statSync(subFolderPath);
      } catch (e) {}
      if (!stats || !stats.isDirectory()) {
        continue;
      }
      if (subFolder.startsWith('ethers')) {
        continue;
      }
      if (subFolder.startsWith('@')) {
        recurse(subFolderPath);
      } else {
        const packageJsonPath = path.join(subFolderPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const basename = path.basename(folderPath);
          if (basename.startsWith('@ethersproject')) {
            fix(packageJsonPath);
            const nodeModulePath = path.join(subFolderPath, 'node_modules');
            if (fs.existsSync(nodeModulePath)) {
              recurse(nodeModulePath);
            }
          } else {
            // recurse(subFolderPath);
          }
        } else {
          recurse(subFolderPath);
        }
      }
    }
  }
}

recurse('node_modules');
recurse('../node_modules/.pnpm');
