/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const page = fs.readFileSync('src/pageList.ts').toString();
const regex = /\.\/pages/gi;
const newPage = page.replace(regex, 'pages');
fs.writeFileSync('./_build/pageList.ts', newPage);
