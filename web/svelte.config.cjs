const sveltePreprocess = require('svelte-preprocess');
const node = require('@sveltejs/adapter-node');
const adapter_ipfs = require('sveltejs-adapter-ipfs');
// const adapter_static = require('@sveltejs/adapter-static');
const pkg = require('./package.json');

/** @type {import('@sveltejs/kit').Config} */
module.exports = {
  // Consult https://github.com/sveltejs/svelte-preprocess
  // for more information about preprocessors
  preprocess: [
    sveltePreprocess({
      defaults: {
        style: 'postcss',
      },
      postcss: true,
    }),
  ],
  kit: {
    adapter: adapter_ipfs({removeBuiltInServiceWorkerRegistration: true, injectPagesInServiceWorker: true}),

    // hydrate the <div id="svelte"> element in src/app.html
    target: '#svelte',

    vite: {
      ssr: {
        noExternal: Object.keys(pkg.dependencies || {}),
      },
      optimizeDeps: {
        // Note: 'bn.js', 'bech32', 'hash.js' where needed to be added as dev dependency for vite to find them (pnpm is stricter and make sub dependency not visible on the node_modules folder)
        include: ['bn.js', 'bech32', 'hash.js', 'graphql'],
      },
    },
  },
};
