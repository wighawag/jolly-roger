import {createPushHandoffs} from './core/service-worker/push-handoff';

/**
 * The hand-offs of pushes the page reads from its URL (QA F23,
 * `core/service-worker/push-handoff.ts`).
 *
 * PROCESS-SCOPED, like the worker registration it feeds (see `./index.ts`):
 * the page's URL is the process's. Its own module, rather than `./index.ts`,
 * because `src/hooks.client.ts` installs it before the router starts, and
 * importing `./index.ts` there would evaluate the app (which reads the hash's
 * parameters) before the hand-off is gone from the URL.
 */
export const pushHandoffs = createPushHandoffs();
