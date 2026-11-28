/**
 * Which colour theme the app runs in, as chosen by the `theme` key of
 * `src/web-config.json`.
 *
 * - `"dark"`: always dark, whatever the browser prefers (the default).
 * - `"light"`: always light, whatever the browser prefers.
 * - `"system"`: follow the browser's `prefers-color-scheme`, live.
 *
 * The setting lives in web-config.json rather than in `routes/+layout.svelte`
 * so a descendant picks its theme in the file it already owns for branding,
 * and never has to edit (and then re-merge) the template's layout.
 *
 * WHY A FORCED THEME NEEDS MORE THAN `defaultMode`
 *
 * mode-watcher's `defaultMode` is only a fallback for "nothing stored yet", and
 * `track={false}` does not stop it reading the system preference either. On a
 * client-rendered page (`ssr = false`), mode-watcher's own state persists
 * `"system"` to localStorage before its `onMount` reads it back, so the stored
 * `"system"` wins over `defaultMode`, and a light-preferring browser gets no
 * `dark` class: every shadcn card then paints white on the app's black page.
 * Once stored, that `"system"` also sticks for later, server-rendered visits.
 * So a forced theme is (re)applied with `setMode` after mode-watcher mounts:
 * see `enforce`.
 */

export const themeSettings = ['dark', 'light', 'system'] as const;
export type ThemeSetting = (typeof themeSettings)[number];

/** What `src/web-config.json` means when it has no `theme` key. */
export const DEFAULT_THEME: ThemeSetting = 'dark';

/**
 * Reads the raw `theme` value from web-config.json. Absent means the default;
 * anything else that is not a known setting throws, so a typo fails the build
 * (the page is prerendered) instead of silently shipping the wrong theme.
 */
export function parseThemeSetting(value: unknown): ThemeSetting {
	if (value === undefined || value === null) return DEFAULT_THEME;
	if (
		typeof value === 'string' &&
		(themeSettings as readonly string[]).includes(value)
	) {
		return value as ThemeSetting;
	}
	throw new Error(
		`web-config.json: "theme" must be one of ${themeSettings
			.map((s) => `"${s}"`)
			.join(', ')}, got ${JSON.stringify(value)}`,
	);
}

/** The props `<ModeWatcher>` takes for a given setting. */
export type ModeWatcherConfig = {
	defaultMode: ThemeSetting;
	track: boolean;
};

export type Theme = {
	setting: ThemeSetting;
	/** Spread onto `<ModeWatcher>`. */
	modeWatcher: ModeWatcherConfig;
	/**
	 * Call from the layout's `onMount` (which runs AFTER `<ModeWatcher>`'s own,
	 * a child mounting first). For a forced theme it overrides whatever
	 * mode-watcher restored; for `"system"` it does nothing.
	 */
	enforce: () => void;
};

export function createTheme(
	value: unknown,
	{setMode}: {setMode: (mode: ThemeSetting) => void},
): Theme {
	const setting = parseThemeSetting(value);
	const forced = setting !== 'system';
	return {
		setting,
		modeWatcher: {defaultMode: setting, track: !forced},
		enforce: () => {
			if (forced) setMode(setting);
		},
	};
}
