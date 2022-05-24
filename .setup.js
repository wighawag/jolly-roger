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

function copyFromAllDefault() {
  const files = fs
    .readdirSync('.')
    .filter((v) => v.endsWith('.default'))
    .map((v) => v.slice(0, v.length - 8));
  files.map(copyFromDefault);
}

copyFromAllDefault();

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
