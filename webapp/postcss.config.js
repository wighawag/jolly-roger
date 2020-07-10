const purgecss = require('@fullhuman/postcss-purgecss')({
  content: ['./**/*.html', './**/*.svelte'],

  whitelistPatterns: [/svelte-/, /^~/, /^!/],

  defaultExtractor: (content) => content.match(/[\w-/:]+(?<!:)/g) || [],
  // defaultExtractor: (content) => content.match(/[A-Za-z0-9-_:/]+/g) || [],
});

const watch = !!process.env.ROLLUP_WATCH;
const useLiveReload = !!process.env.LIVERELOAD;
const dev = watch || useLiveReload;
const production = !dev;

module.exports = {
  plugins: [
    require('postcss-import')(),
    require('tailwindcss'),
    require('autoprefixer'),
    ...(production ? [purgecss] : []),
  ],
};
