import {describe, it, expect, afterEach} from 'vitest';
import {get} from 'svelte/store';
import {
	LET_GO,
	createWorldClaim,
	letGoOfWorld,
	type WorldClaim,
} from '$lib/embedded/claim';

/**
 * ONE TAB PER WORLD, on Node's own `navigator.locks` and `BroadcastChannel`.
 *
 * Two claims in one process stand for two tabs of one origin: Node's lock
 * manager and channels are process-wide, the way a browser's are origin-wide, so
 * nothing here is faked except what a reload does (it is the test's `reload`,
 * which releases, as closing the document would). Each test uses its own lock
 * name, so a claim one test leaves held cannot refuse the next.
 */

const made: WorldClaim[] = [];
let counter = 0;

function names(): string {
	counter++;
	return `test-world-${counter}-${Date.now()}`;
}

function tab(
	name: string,
	letGo: () => Promise<void> = async () => {},
): {claim: WorldClaim; reloads: () => number; order: string[]} {
	let reloads = 0;
	const order: string[] = [];
	const claim: WorldClaim = createWorldClaim({
		name,
		letGo: async () => {
			order.push(`letGo while ${get(claim).step}`);
			await letGo();
		},
		reload: () => {
			reloads++;
			order.push('reload');
			// What the browser does when the holder's document goes away.
			void claim.release();
		},
	});
	made.push(claim);
	return {claim, reloads: () => reloads, order};
}

afterEach(async () => {
	await Promise.all(made.splice(0).map((claim) => claim.release()));
});

describe('one tab per world', () => {
	it('is unasked until a tab asks', () => {
		const {claim} = tab(names());
		expect(get(claim).step).toBe('Unasked');
	});

	it('refuses a second claim while the first holds the world', async () => {
		const name = names();
		const first = tab(name);
		const second = tab(name);

		expect(await first.claim.claim()).toBe(true);
		expect(get(first.claim).step).toBe('Held');
		expect(await second.claim.claim()).toBe(false);
		expect(get(second.claim).step).toBe('Refused');
	});

	it('does not refuse a different world', async () => {
		const first = tab(names());
		const second = tab(names());
		expect(await first.claim.claim()).toBe(true);
		expect(await second.claim.claim()).toBe(true);
	});

	it('is granted once the holder lets go of it', async () => {
		const name = names();
		const first = tab(name);
		const second = tab(name);
		await first.claim.claim();
		expect(await second.claim.claim()).toBe(false);

		await first.claim.release();
		expect(await second.claim.claim()).toBe(true);
	});

	it('asks the holder over the channel, and is granted after it has let go and reloaded', async () => {
		const name = names();
		const first = tab(name);
		const second = tab(name);
		await first.claim.claim();
		await second.claim.claim();

		const takeOver = second.claim.takeOver();
		expect(get(second.claim).step).toBe('Waiting');
		await takeOver;

		expect(get(second.claim).step).toBe('Held');
		expect(first.reloads()).toBe(1);
		// The holder SAID SO FIRST, so whatever rendered its world had unmounted
		// it before the world was let go of, and reloaded only after.
		expect(first.order).toEqual(['letGo while LettingGo', 'reload']);
	});

	it('reloads the holder even when letting go of its world fails', async () => {
		const name = names();
		const first = tab(name, async () => {
			throw new Error('the world would not stop');
		});
		const second = tab(name);
		await first.claim.claim();

		await second.claim.takeOver();
		expect(first.reloads()).toBe(1);
		expect(get(second.claim).step).toBe('Held');
	});

	it('refuses the reloaded holder, because the tab that asked has the world now', async () => {
		const name = names();
		const first = tab(name);
		const second = tab(name);
		await first.claim.claim();
		await second.claim.takeOver();

		// The holder's page after its reload: a fresh claim, as a fresh document.
		const reloaded = tab(name);
		expect(await reloaded.claim.claim()).toBe(false);
	});

	it('stops waiting when abandoned, and the holder keeps the world if it never heard', async () => {
		const name = names();
		const first = tab(name);
		await first.claim.claim();
		// A tab that queues for the lock WITHOUT asking: what remains of a
		// take-over once its message is lost.
		const second = tab(name);
		const silent = createWorldClaim({
			name,
			letGo: async () => {},
			openChannel: () => ({
				postMessage: () => {},
				addEventListener: () => {},
				close: () => {},
			}),
		});
		made.push(silent);
		await second.claim.claim();
		void silent.takeOver();
		expect(get(silent).step).toBe('Waiting');
		silent.abandon();
		expect(get(silent).step).toBe('Refused');

		await first.claim.release();
		// The abandoned request is gone, so the lock is free for an ordinary claim.
		expect(await second.claim.claim()).toBe(true);
	});

	it('ignores any other message on its channel', async () => {
		const name = names();
		const first = tab(name);
		await first.claim.claim();
		const channel = new BroadcastChannel(name);
		channel.postMessage('hello');
		channel.close();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(get(first.claim).step).toBe('Held');
		expect(first.reloads()).toBe(0);
		expect(LET_GO).toBe('let-go');
	});
});

describe('letting go of a world', () => {
	it('waits for its boot, disposes it, then waits on one more request', async () => {
		const order: string[] = [];
		const world = {
			provider: {
				request: async (args: {method: string}) => {
					order.push(args.method);
					return '0x1';
				},
			},
			dispose: async () => {
				order.push('dispose');
			},
		};
		let finishBoot: (status: {
			step: string;
			world?: typeof world;
		}) => void = () => {};
		const boot = new Promise<{step: string; world?: typeof world}>(
			(resolve) => {
				finishBoot = resolve;
			},
		);
		const letting = letGoOfWorld(boot);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual([]);

		finishBoot({step: 'Ready', world});
		await letting;
		expect(order).toEqual(['dispose', 'eth_blockNumber']);
	});

	it('has nothing to do for a world never started or a boot that failed', async () => {
		await expect(letGoOfWorld(undefined)).resolves.toBeUndefined();
		await expect(
			letGoOfWorld(Promise.resolve({step: 'Failed'})),
		).resolves.toBeUndefined();
		await expect(
			letGoOfWorld(Promise.reject(new Error('boot threw'))),
		).resolves.toBeUndefined();
	});
});
