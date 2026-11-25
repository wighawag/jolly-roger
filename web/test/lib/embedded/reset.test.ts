import {describe, it, expect, vi} from 'vitest';
import {get} from 'svelte/store';
import {createWorldReset} from '$lib/embedded/reset';

/**
 * START A FRESH WORLD (QA F8): what `$lib/embedded/reset` promises a route, in
 * order. The reload is the test's, as in `claim.test.ts`.
 */
describe('starting a fresh world', () => {
	function tab(letGo: () => Promise<void> = async () => {}) {
		const order: string[] = [];
		const reset = createWorldReset({
			letGo: async () => {
				order.push(`letGo while ${get(reset).step}`);
				await letGo();
			},
			forget: () => order.push('forget'),
			reload: () => order.push('reload'),
		});
		return {reset, order};
	}

	it('is idle until asked', () => {
		expect(get(tab().reset).step).toBe('Idle');
	});

	it('says Resetting first, then stops the world, then forgets it, then reloads', async () => {
		const {reset, order} = tab();
		const done = reset.reset();
		// Synchronously: a route renders something else at once, which is what
		// unmounts the world before it is let go of.
		expect(get(reset).step).toBe('Resetting');
		expect(order).toEqual([]);
		await done;
		expect(order).toEqual(['letGo while Resetting', 'forget', 'reload']);
	});

	it('forgets only once the world has stopped, so a stopping world cannot write its id back', async () => {
		let stopped!: () => void;
		const {reset, order} = tab(
			() => new Promise<void>((resolve) => (stopped = resolve)),
		);
		const done = reset.reset();
		await vi.waitFor(() => expect(order).toEqual(['letGo while Resetting']));
		stopped();
		await done;
		expect(order).toEqual(['letGo while Resetting', 'forget', 'reload']);
	});

	it('forgets and reloads anyway when the world will not stop', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const {reset, order} = tab(async () => {
			throw new Error('stuck');
		});
		await reset.reset();
		expect(order).toEqual(['letGo while Resetting', 'forget', 'reload']);
		error.mockRestore();
	});

	it('runs once however often it is pressed', async () => {
		const {reset, order} = tab();
		await Promise.all([reset.reset(), reset.reset()]);
		expect(order.filter((step) => step === 'reload')).toHaveLength(1);
	});
});
