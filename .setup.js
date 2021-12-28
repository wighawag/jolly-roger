#!/usr/bin/env node
const fs = require('fs');

let anyChanges = false;
function copyUnlessExists(from, to) {
  if (!fs.existsSync(to)) {
    if (fs.existsSync(from)) {
      anyChanges = true;
      fs.copyFileSync(from, to);
    }
  }
}

function writeIfNotExists(p, content) {
  if (!fs.existsSync(p)) {
    anyChanges = true;
    fs.writeFileSync(p, content);
  }
}

function copyFromDefault(p) {
  copyUnlessExists(`${p}.default`, p);
}

function copyPrettierFixVSCodeSettings(p) {
  if (fs.existsSync('_prettier-vscode-fix/vscode-settings.json')) {
    if (!fs.existsSync(`${p}/.vscode`)) {
      fs.mkdirSync(`${p}/.vscode`);
    }
  }
  copyUnlessExists('_prettier-vscode-fix/vscode-settings.json', `${p}/.vscode/settings.json`);
}

['jolly-roger.code-workspace', '.env', '.env.production', '.env.staging'].map(copyFromDefault);

['common-lib', 'contracts', 'subgraph', 'web'].map(copyPrettierFixVSCodeSettings);

switch (process.platform) {
  case 'win32':
    writeIfNotExists(
      '.newsh.json',
      `
{
  "terminalApp": "cmd"
}
`
    );
    break;
  case 'linux':
    writeIfNotExists(
      '.newsh.json',
      `
  {
    "terminalApp": "xterm",
    "terminalAppSetup": "-hold -e {{command}}"
  }
  `
    );
    break;
}

if (anyChanges) {
  console.log('setting up defaults...');
}

const execSync = require('child_process').execSync;
function npmInstall(dir) {
  console.log(`INSTALLING ${dir}...`);
  let exitCode = 0;
  try {
    execSync('npm install', {cwd: dir, stdio: 'inherit'});
  } catch (err) {
    exitCode = err.status;
  }
  if (exitCode) {
    process.exit(exitCode);
  }
}
npmInstall('_prettier-vscode-fix');
