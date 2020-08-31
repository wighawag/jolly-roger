#!/usr/bin/env node
const fs = require('fs');
function copyFromDefault(p) {
  if (!fs.existsSync(p)) {
    const defaultFile = `${p}.default`;
    if (fs.existsSync(defaultFile)) {
      fs.copyFileSync(`${p}.default`, p);
    }
  }
}
['{{=_.paramCase(it.name)}}.code-workspace', '.vscode/settings.json', '.env', '.env.production', '.env.staging'].map(
  copyFromDefault
);
