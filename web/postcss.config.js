/* eslint-disable @typescript-eslint/no-var-requires */
const autoprefixer = require('autoprefixer');
const tailwindcss = require('tailwindcss');

const plugins = [tailwindcss];

if (process.env.NODE_ENV !== 'development') {
  plugins.push(autoprefixer); // crash chrome when inspecting element, so disable it in development mode
}

module.exports = {
  plugins,
};
