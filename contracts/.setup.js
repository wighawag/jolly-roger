#!/usr/bin/env node
const fs = require('fs-extra');
function copyFromDefault(p) {
  if (!fs.existsSync(p)) {
    const defaultFile = `${p}.default`;
    if (fs.existsSync(defaultFile)) {
      fs.copyFileSync(`${p}.default`, p);
    }
  }
}

[/*'.vscode/settings.json', */ '.vscode/extensions.json', '.vscode/launch.json'].map(copyFromDefault);

// needed for dapptools as it does not allow to set further --allow-path to solc and solc does not support symlink very well it seems
fs.emptyDirSync('_lib/');
fs.emptyDirSync('_lib/openzeppelin/contracts');
fs.copySync('node_modules/@openzeppelin/contracts', '_lib/openzeppelin/contracts', {dereference: true});

fs.emptyDirSync('_lib/hardhat');
fs.copySync('node_modules/hardhat/console.sol', '_lib/hardhat/console.sol', {dereference: true});

fs.emptyDirSync('_lib/hardhat-deploy/solc_0.6');
fs.copySync('node_modules/hardhat-deploy/solc_0.6', '_lib/hardhat-deploy/solc_0.6', {dereference: true});
fs.emptyDirSync('_lib/hardhat-deploy/solc_0.7');
fs.copySync('node_modules/hardhat-deploy/solc_0.7', '_lib/hardhat-deploy/solc_0.7', {dereference: true});
fs.emptyDirSync('_lib/hardhat-deploy/solc_0.8');
fs.copySync('node_modules/hardhat-deploy/solc_0.8', '_lib/hardhat-deploy/solc_0.8', {dereference: true});
