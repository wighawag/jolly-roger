export default {
  // minify: false,
  // sourcemap: true,
  optimizeDeps: {
    exclude: ['web3w', '{{=_.paramCase(it.name)}}-common'], // allow to develop with hot reload
  },
};
