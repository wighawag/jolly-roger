import type {PluginOption} from 'vite';

/**
 * The vite plugins THIS project adds to the template's.
 *
 * Empty here, on purpose. This file exists so that a descendant, a variant or a
 * feature branch can add a plugin WITHOUT editing `vite.config.ts`.
 *
 * WHY THAT IS WORTH A FILE. `vite.config.ts` is a template file: it travels
 * into every project scaffolded from this one and is merged down into every
 * repo that tracks it, and it keeps developing here for reasons that have
 * nothing to do with any one descendant. So every descendant that edits it buys
 * a conflict in every future merge, forever - and the whole tree already does.
 * Measured when this was written: `template-svelte-tailwind`'s ONLY change to
 * `vite.config.ts` was one import and one line in `plugins`; the shadcn variant
 * inherited exactly that; jolly-roger carries the same line; and further down,
 * a repo with an art build had restructured the file wholesale to get ~300
 * lines of sprite pipeline out of the middle of it.
 *
 * They were all paying a merge tax to say one thing, and it is the same one
 * thing every time: "and also this plugin".
 *
 * This is the shape the tree already uses where it has learned this lesson: a
 * SMALL FILE WHOSE JOB IS TO DIFFER, so that the large shared file does not
 * have to. `core/connection/mode.ts` is the other instance, where one constant
 * is the whole difference between three branches.
 *
 * ## The contract
 *
 * **Position.** These are spread in immediately before `sveltekit()`, and after
 * `devtoolsJson()`. That is not arbitrary and it is not free to change: it is
 * where every repo in this tree already put its extra plugin, and Tailwind in
 * particular documents that `tailwindcss()` must come before `sveltekit()`. If
 * you need a plugin AFTER sveltekit, say so here rather than reaching into
 * `vite.config.ts`, and change the spread's position for everyone.
 *
 * **A FUNCTION, not a constant array**, and this one is load-bearing rather
 * than stylistic. `vite.config.ts` is also the vitest config, and it declares
 * `projects` that `extends` it - so the config is evaluated several times in
 * one process. A module-level array would hand every one of those the SAME
 * plugin objects, and vite plugins hold per-build state (a watcher, a resolved
 * command, a cache). Sharing them across builds is the kind of bug that shows
 * up as one project's watcher firing into another's build. Returning a fresh
 * array per call costs nothing and removes the question.
 *
 * **Falsy entries are fine.** Vite filters them out of `plugins`, so a plugin
 * that decides it has nothing to do can `return false` from its own factory
 * and the caller stays a single unconditional line. That is what keeps this
 * file free of `if` statements about art folders, environment variables and
 * whether this is a test run - those belong to the plugin that cares.
 */
export function extraPlugins(): PluginOption[] {
	return [];
}
