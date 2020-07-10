const logger = console;

export default {
  trace(...args) {
    logger.trace(...args);
  },
  debug(...args) {
    logger.debug(...args);
  },
  info(...args) {
    logger.info(...args);
  },
  warn(...args) {
    logger.error(...args);
  },
  error(...args) {
    logger.error(...args);
  },
  fatal(...args) {
    logger.fatal(...args);
  },
  silent(...args) {
    logger.silent(...args);
  },
};
