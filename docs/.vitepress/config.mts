import { defineConfig } from 'vitepress'
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mainContract = 'Registry';

const contractFilenames = fs.readdirSync(path.join(__dirname, '../contracts'));
const contractNames = contractFilenames.map((filename) => path.basename(filename, '.md'));
const firstContractName = contractNames.indexOf(mainContract) == -1 ? contractNames[0] : mainContract;

const contracts = contractNames.sort((a,b) => a === firstContractName ? -1 : b === firstContractName ? 1 : (a > b ? 1: a <b ? -1 : 0))
.map(name => {
  return {
    text: name, link: `/contracts/${name}/`
  };
});

const isRunningOnVercel = !!process.env.VERCEL;

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: isRunningOnVercel ? '/' : '/jolly-roger/',
  title: "Jolly Roger",
  description: "Build and Deploy for Eternity. Jolly Roger is a production-ready template for decentralised applications.",
  head: [
    
  ],
  themeConfig: {
    logo: "/icon.svg",
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/guide/getting-started/' },
      { text: 'Contracts', link: `/contracts/${firstContractName}/` }
    ],

    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started/' },
          { text: 'Contracts', items: contracts}
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/wighawag/jolly-roger#readme' },
      { icon: 'twitter', link: 'https://twitter.com/jollyroger_eth' },
    ],

    search: {
      provider: 'local'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2019-present Ronan Sandford'
    }
  },
  rewrites: {
    'contracts/:pkg.md': 'contracts/:pkg/index.md'
  }
})
