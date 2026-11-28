import {setMode} from 'mode-watcher';
import {createTheme} from './core/theme';
import webConfig from '../web-config.json';

/**
 * The colour theme, chosen by `theme` in `src/web-config.json` ("dark",
 * "light" or "system"; absent means "dark", see `core/theme`).
 * `routes/+layout.svelte` wires it into `<ModeWatcher>`, so a descendant never
 * edits the layout to change it.
 *
 * Its own module, rather than `./index.ts`, because this tier introduces it:
 * `./index.ts` is the stem's file, which every descendant modifies, and adding
 * to it here would make it a divergence and a conflict on every cascade.
 */
export const theme = createTheme((webConfig as {theme?: unknown}).theme, {
	setMode,
});
