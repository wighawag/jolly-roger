import preprocess from 'svelte-preprocess';
import adapter_ipfs from 'sveltejs-adapter-ipfs';
import fs from 'fs';

if (!process.env.VITE_CHAIN_ID) {
  try {
    const contractsInfo = JSON.parse(fs.readFileSync('./src/lib/contracts.json'));
    process.env.VITE_CHAIN_ID = contractsInfo.chainId;
  } catch (e) {
    console.error(e);
  }
}

let outputFolder = './build';

if (process.env.VERCEL) {
  // allow no config when creating a vercel project
  outputFolder = '../public';
  console.log('building on VERCEL...');
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: preprocess(),

  kit: {
    adapter: adapter_ipfs({
      assets: outputFolder,
      pages: outputFolder,
      removeBuiltInServiceWorkerRegistration: true,
      injectPagesInServiceWorker: true,
      injectDebugConsole: true,
    }),
    target: '#svelte',
    trailingSlash: 'ignore',
  },
};

export default config;
