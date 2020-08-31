/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const page = fs.readFileSync('src/pages.ts').toString();
const regex = /\.\/pages/gi;
const newPage = page.replace(regex, 'pages');
fs.writeFileSync('./_build/pages.ts', newPage);
