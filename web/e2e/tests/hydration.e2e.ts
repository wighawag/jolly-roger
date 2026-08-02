import {test, expect, describe} from '../fixtures/test';

// The app server-renders its chrome in the disconnected state and the browser's
// first render is that same state, which is what makes prerendering safe
// (ADR-0002). A hydration mismatch would mean the two disagree, so assert it
// directly rather than trusting that the markup happens to line up.
//
// The build is the gate for SSR *crashes* (prerendering every route in Node);
// this is the gate for SSR/CSR *divergence*, which a successful build cannot
// catch.
describe('Hydration', () => {
	for (const path of ['/', '/demo/']) {
		test(`hydrates ${path} without a mismatch`, async ({page}) => {
			const complaints: string[] = [];
			const record = (text: string) => {
				if (/hydrat/i.test(text)) complaints.push(text);
			};

			page.on('console', (message) => record(message.text()));
			page.on('pageerror', (error) => record(String(error)));

			await page.goto(path);
			await page.waitForLoadState('load');
			// Hydration runs just after load; give it room before asserting.
			await page.waitForTimeout(1000);

			expect(complaints).toEqual([]);
		});
	}
});
