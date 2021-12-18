/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
const chokidar = require('chokidar');

// from https://github.com/kimmobrunfeldt/chokidar-cli/blob/331243f66c690771fd85591f37badc2d38dfafd5/utils.js
const {spawn} = require('child_process');

// Try to resolve path to shell.
// We assume that Windows provides COMSPEC env variable
// and other platforms provide SHELL env variable
const SHELL_PATH = process.env.SHELL || process.env.COMSPEC;
const EXECUTE_OPTION = process.env.COMSPEC !== undefined && process.env.SHELL === undefined ? '/c' : '-c';

// Wrapping tos to a promise is a bit wrong abstraction. Maybe RX suits
// better?
function run(cmd, opts) {
  if (!SHELL_PATH) {
    // If we cannot resolve shell, better to just crash
    throw new Error('$SHELL environment variable is not set.');
  }

  opts = Object.assign(
    {},
    {
      pipe: true,
      cwd: undefined,
      // eslint-disable-next-line no-unused-vars
      callback(child) {
        // Since we return promise, we need to provide
        // this callback if one wants to access the child
        // process reference
        // Called immediately after successful child process
        // spawn
      },
    },
    opts
  );

  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn(SHELL_PATH, [EXECUTE_OPTION, cmd], {
        cwd: opts.cwd,
        stdio: opts.pipe ? 'inherit' : null,
      });
    } catch (error) {
      return reject(error);
    }

    opts.callback(child);

    function errorHandler(err) {
      child.removeListener('close', closeHandler);
      reject(err);
    }

    function closeHandler(exitCode) {
      child.removeListener('error', errorHandler);
      resolve(exitCode);
    }

    child.once('error', errorHandler);
    child.once('close', closeHandler);
  });
}

const args = process.argv.slice(2);
const contractsPath = args[0];

function setup(command) {
  let running = false;
  let pending = false;
  return async (event, path) => {
    console.log({command, event, path});
    if (running) {
      pending = true;
      console.log('waiting for current execution to finish...');
      return;
    }
    running = true;
    do {
      pending = false;
      try {
        await run(command);
      } catch (e) {
        console.error(e);
      }
    } while (pending);
    running = false;
  };
}
chokidar
  .watch(['src', 'templates', contractsPath], {ignoreInitial: true})
  .on('all', setup(`npm run deploy ${contractsPath}`));
chokidar.watch(['schema.graphql'], {ignoreInitial: true}).on('all', setup(`npm run codegen`));
