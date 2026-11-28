import {describe, it, expect, vi} from 'vitest';
import {
	createTheme,
	parseThemeSetting,
	DEFAULT_THEME,
} from '../../../../src/lib/core/theme';
import webConfig from '../../../../src/web-config.json';

describe('parseThemeSetting', () => {
	it('defaults to dark when web-config.json has no theme', () => {
		expect(DEFAULT_THEME).toBe('dark');
		expect(parseThemeSetting(undefined)).toBe('dark');
		expect(parseThemeSetting(null)).toBe('dark');
	});

	it('accepts the three settings', () => {
		expect(parseThemeSetting('dark')).toBe('dark');
		expect(parseThemeSetting('light')).toBe('light');
		expect(parseThemeSetting('system')).toBe('system');
	});

	it('throws on anything else, rather than shipping a silent default', () => {
		expect(() => parseThemeSetting('Dark')).toThrow(/"theme" must be one of/);
		expect(() => parseThemeSetting('auto')).toThrow(/"theme" must be one of/);
		expect(() => parseThemeSetting(true)).toThrow(/"theme" must be one of/);
	});

	it("accepts this repo's own web-config.json", () => {
		expect(() =>
			parseThemeSetting((webConfig as {theme?: unknown}).theme),
		).not.toThrow();
	});
});

describe('createTheme', () => {
	it.each(['dark', 'light'] as const)(
		'forces %s: not tracked, and re-applied on enforce()',
		(setting) => {
			const setMode = vi.fn();
			const theme = createTheme(setting, {setMode});
			expect(theme.modeWatcher).toEqual({defaultMode: setting, track: false});
			theme.enforce();
			expect(setMode).toHaveBeenCalledExactlyOnceWith(setting);
		},
	);

	it('follows the system for "system", and enforce() leaves it alone', () => {
		const setMode = vi.fn();
		const theme = createTheme('system', {setMode});
		expect(theme.modeWatcher).toEqual({defaultMode: 'system', track: true});
		theme.enforce();
		expect(setMode).not.toHaveBeenCalled();
	});
});
