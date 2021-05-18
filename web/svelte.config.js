import preprocess from 'svelte-preprocess';
import adapter_ipfs from 'sveltejs-adapter-ipfs';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: preprocess(),

  kit: {
    adapter: adapter_ipfs({removeBuiltInServiceWorkerRegistration: true, injectPagesInServiceWorker: true}),
    target: '#svelte',
  },
};

export default config;

// sveltePreprocess({
//   defaults: {
//     style: 'postcss',
//   },
//   postcss: true,
// }),

// vite: {
//   ssr: {
//     noExternal: Object.keys(pkg.dependencies || {}),
//   },
//   optimizeDeps: {
//     // Note: 'bn.js', 'bech32', 'hash.js' where needed to be added as dev dependency for vite to find them (pnpm is stricter and make sub dependency not visible on the node_modules folder)
//     include: ['bn.js', 'bech32', 'hash.js', 'graphql'],
//   },
// },
