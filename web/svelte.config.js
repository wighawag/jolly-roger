/* eslint-disable @typescript-eslint/no-var-requires */
const {postcss, typescript} = require('svelte-preprocess');
module.exports = {
  preprocess: [typescript(), postcss()],
};
