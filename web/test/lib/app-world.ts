import deployGreetingsRegistry from 'jolly-roger-contracts/deploy/001_deploy_greetings_registry.js';

/**
 * WHAT AN EMBEDDED WORLD MUST DEPLOY for the app's context to work, and the
 * rocketh setup it deploys with, in ONE place, so a descendant that replaces
 * the app's contracts (a game, its own contracts package) edits this file and
 * not every suite that boots a world. Read by `embedded/world.test.ts` and
 * `embedded/deployments.test.ts`. The names are template-zk-game's, where this
 * seam was born; its e2e twin is `GAME` of `web/e2e/routes.ts`.
 */
export {config, extensions} from 'jolly-roger-contracts/rocketh/config.js';

/** The deploy scripts a world runs, in order. */
export const GAME_SCRIPTS = [
	{id: '001_deploy_greetings_registry', module: deployGreetingsRegistry},
];

/** The deployment name of the contract the app's context reads. */
export const GAME_CONTRACT = 'GreetingsRegistry' as const;
