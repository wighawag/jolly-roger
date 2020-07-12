// //////////////////////////////////////////// CONFIG ///////////////////////////////////////////
const envList = ['THE_GRAPH_HTTP', 'THE_GRAPH_WS'];
// ///////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Environment variables
 * ANALYSE: output a analyse file showing the size of the output
 * CONTRACTS_INFO: development | production | staging
 * APPLICATION_URL: allow to setup url when needed (like meta tags)
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import svelte from 'rollup-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';
import svelte_hot from 'rollup-plugin-svelte-hot';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import image from '@rollup/plugin-image'; // TODO do not use, load image dynamically instead
import alias from '@rollup/plugin-alias'; // TODO do not use, load image dynamically instead
import replace from '@rollup/plugin-replace';
import livereload from 'rollup-plugin-livereload';
import {terser} from 'rollup-plugin-terser';
import {sizeSnapshot} from 'rollup-plugin-size-snapshot';
import visualizer from 'rollup-plugin-visualizer';
import sizes from 'rollup-plugin-sizes';
import analyze from 'rollup-plugin-analyzer';
import hasha from 'hasha';

import routes from './src/routes';

const {globalCSS, ipfsApp, clean} = require('./build').rollup;

// NOTE The NOLLUP env variable is picked by various HMR plugins to switch
// in compat mode. You should not change its name (and set the env variable
// yourself if you launch nollup with custom comands).
const nollup = !!process.env.NOLLUP;
const watch = !!process.env.ROLLUP_WATCH;
const useLiveReload = !!process.env.LIVERELOAD;

const dev = watch || useLiveReload;
const production = !dev;
const hot = nollup; //watch && !useLiveReload;

const analyse = !!process.env.ANALYSE;

require('dotenv').config({
  path: dev ? path.resolve(process.cwd(), '.env.development') : undefined,
});
const exportFolder = nollup ? 'nollup' : 'public';

const toReplace = {};
for (const envVar of envList) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} need to be set`);
  }
  toReplace[`process.env.${envVar}`] = JSON.stringify(process.env[envVar]);
}
toReplace[`__DEBUG__`] = production ? 'false' : 'true';

const contractsInfo = process.env.CONTRACTS_INFO || 'development';

const svelteConfig = {
  preprocess: sveltePreprocess({postcss: true}),
  dev: !production,
};

if (production) {
  svelteConfig.css = (css) => {
    css.write(
      `${exportFolder}/_css/components-${hasha(css.code, {
        algorithm: 'sha1',
        replace: false,
      }).slice(0, 8)}.css`
    );
  };
}

if (hot) {
  svelteConfig.hot = {
    optimistic: true,
    noPreserveState: false,
    noDisableCss: true,
  };
}

const output = {
  sourcemap: true,
  format: 'iife',
  name: 'app',
  dir: exportFolder,
  entryFileNames: analyse ? '_js/[name].js' : '_js/[name]-[hash].js',
};
if (nollup) {
  delete output.dir;
  output.file = `${exportFolder}/_js/bundle.js`;
  delete output.entryFileNames;
}

export default {
  input: 'src/main.js',
  output,
  plugins: [
    !nollup && clean(exportFolder),
    !nollup && globalCSS(exportFolder, 'src/global.css', {hash: production}),
    replace(toReplace),
    alias({
      entries: [
        {
          find: 'contractsInfo',
          customResolver: (what, from) => {
            return path.resolve(
              __dirname,
              `./src/contracts/${contractsInfo}.json`
            );
          },
        },
      ],
    }),
    (nollup ? svelte_hot : svelte)(svelteConfig),

    resolve({
      // mainFields: ["module", "browser"],
      // browser: true,
      mainFields: ['browser'], // Important
      dedupe: ['svelte'],
    }),
    commonjs(),
    json(),
    image(),

    analyse && sizes(),
    analyse && visualizer(),
    analyse && sizeSnapshot(),
    analyse &&
      analyze({
        writeTo: function (analysisString) {
          fs.writeFileSync('./rollup.analysis', analysisString);
        },
      }),

    production && terser(),

    replace({
      'process.env.NODE_ENV': JSON.stringify(
        dev ? 'development' : 'production'
      ),
    }),

    production && ipfsApp(exportFolder, routes),

    dev && !nollup && serve(),

    useLiveReload &&
      (console.log('use live reload') || livereload(exportFolder)),
  ],
  watch: {
    clearScreen: false,
  },
};

function serve() {
  let started = false;

  return {
    writeBundle() {
      if (!started) {
        started = true;

        // , '--', '--dev'(with sirv)
        require('child_process').spawn('npm', ['run', 'start'], {
          stdio: ['ignore', 'inherit', 'inherit'],
          shell: true,
        });
      }
    },
  };
}
