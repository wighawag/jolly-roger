export {version} from '$app/environment';

/**
 * SvelteKit's build version, re-exported so the rest of the app can report it
 * without naming the framework.
 *
 * This is a build identity string (`config.kit.version.name`, defaulting to a
 * timestamp), and it is genuinely SvelteKit's: Vite has no equivalent, which is
 * why this is a re-export here rather than an `import.meta.env` read like the
 * one in `core/service-worker/index.ts`.
 *
 * A re-export rather than a wrapper on purpose. There is nothing to adapt, only
 * somewhere for the import to live, and inventing a function around a constant
 * would be indirection pretending to be a seam.
 */
