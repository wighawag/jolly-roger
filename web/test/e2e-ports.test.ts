import {createServer, type Server} from 'node:net';
import {afterEach, describe, expect, it} from 'vitest';
import {anyFreePort, e2ePort, isPortFree} from '../e2e/free-port';

const held: Server[] = [];
afterEach(async () => {
	await Promise.all(held.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** Occupy `port` (0: any) the way another process's server would, and say which one. */
function hold(port = 0): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen({port}, () => {
			held.push(server);
			resolve((server.address() as {port: number}).port);
		});
	});
}

describe('the e2e servers ports', () => {
	it('takes the default when it is free, and writes the choice back for the workers', async () => {
		const preferred = await anyFreePort();
		const env: Record<string, string | undefined> = {};
		expect(await e2ePort(env, 'E2E_TEST_PORT', preferred)).toBe(preferred);
		expect(env.E2E_TEST_PORT).toBe(String(preferred));
	});

	it('steps aside to a free port when the default is held', async () => {
		const busy = await hold();
		expect(await isPortFree(busy)).toBe(false);
		const env: Record<string, string | undefined> = {};
		const port = await e2ePort(env, 'E2E_TEST_PORT', busy);
		expect(port).not.toBe(busy);
		expect(await isPortFree(port)).toBe(true);
		expect(env.E2E_TEST_PORT).toBe(String(port));
	});

	it('uses a port that was set as given, even a busy one, so the run fails naming it', async () => {
		const busy = await hold();
		const env: Record<string, string | undefined> = {
			E2E_TEST_PORT: String(busy),
		};
		expect(await e2ePort(env, 'E2E_TEST_PORT', 4273)).toBe(busy);
	});

	it('reads the port a first evaluation chose, as a worker re-evaluating the config does', async () => {
		const busy = await hold();
		const env: Record<string, string | undefined> = {};
		const first = await e2ePort(env, 'E2E_TEST_PORT', busy);
		expect(await e2ePort(env, 'E2E_TEST_PORT', busy)).toBe(first);
	});
});
