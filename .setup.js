#!/usr/bin/env node
const fs = require('fs');

if (!fs.existsSync('contracts/.vscode/settings.json')) {
    fs.copyFileSync('contracts/.vscode/settings.json.default', 'contracts/.vscode/settings.json');
}
