import {test, expect, type Browser} from '@playwright/test';
import {PLAIN_URL} from '../ports';
import webConfig from '../../src/web-config.json' with {type: 'json'};

/**
 * The theme chosen in `src/web-config.json`, against a real browser whose
 * colour-scheme preference disagrees with it.
 *
 * The unit test in `test/lib/core/theme/theme.test.ts` pins the RULE (which
 * ModeWatcher options each setting maps to). This pins the WIRING, which is
 * what actually broke: `defaultMode="dark"` alone still TRACKS the system
 * preference in mode-watcher, so a light-preferring browser got no `dark`
 * class, and every shadcn card (toasts, the update banner) painted white on
 * the app's black page.
 *
 * The bug only showed on a client-rendered page (`ssr = false`), where
 * mode-watcher persists `"system"` to localStorage before reading it back, and
 * that stored `"system"` then wins over `defaultMode` on every later visit
 * too. A prerendered page with empty storage never hit it, so each case also
 * runs with `"system"` already in storage, which is the state that broke.
 *
 * Driven by the config rather than a hard-coded "dark", so a descendant that
 * picks another theme keeps a test that checks ITS choice.
 */

const theme = ((webConfig as {theme?: string}).theme ?? 'dark') as
	'dark' | 'light' | 'system';

async function htmlIsDark(
	browser: Browser,
	colorScheme: 'light' | 'dark',
	storedMode: string | null,
): Promise<boolean> {
	const context = await browser.newContext({colorScheme});
	if (storedMode !== null) {
		await context.addInitScript((mode) => {
			localStorage.setItem('mode-watcher-mode', mode);
		}, storedMode);
	}
	try {
		const page = await context.newPage();
		await page.goto(`${PLAIN_URL}/`);
		await page.waitForLoadState('load');
		// mode-watcher applies the mode on mount, in an animation frame, so let
		// any client-side correction land before reading the result.
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		return await page.evaluate(() =>
			document.documentElement.classList.contains('dark'),
		);
	} finally {
		await context.close();
	}
}

for (const preference of ['light', 'dark'] as const) {
	for (const storedMode of [null, 'system']) {
		const expected =
			theme === 'system' ? preference === 'dark' : theme === 'dark';
		const storage =
			storedMode === null ? 'empty storage' : `"${storedMode}" stored`;
		test(`theme "${theme}", browser prefers ${preference}, ${storage}: html is ${expected ? 'dark' : 'light'}`, async ({
			browser,
		}) => {
			expect(await htmlIsDark(browser, preference, storedMode)).toBe(expected);
		});
	}
}
