const logger = console;

export default {
  trace(...args) {
    if (process.browser) {
      logger.trace(...args);
    }
  },
  debug(...args) {
    if (process.browser) {
      logger.debug(...args);
    }
  },
  info(...args) {
    if (process.browser) {
      logger.info(...args);
    }
  },
  warn(...args) {
    if (process.browser) {
      logger.error(...args);
    }
  },
  error(...args) {
    if (process.browser) {
      logger.error(...args);
    }
  },
  fatal(...args) {
    if (process.browser) {
      logger.fatal(...args);
    }
  },
  silent(...args) {
    if (process.browser) {
      logger.silent(...args);
    }
  }
};
