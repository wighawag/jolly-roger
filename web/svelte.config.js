/* eslint-disable @typescript-eslint/no-var-requires */
const {typescript} = require('svelte-preprocess');
module.exports = {
  preprocess: [typescript()],
};
