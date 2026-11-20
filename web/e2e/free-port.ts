import {createServer} from 'node:net';

/** Whether nothing listens on `port` (on any address): a throwaway server can bind it. */
export function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once('error', () => resolve(false));
		server.listen({port, exclusive: true}, () =>
			server.close(() => resolve(true)),
		);
	});
}

/** A port the system says is free now. */
export function anyFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen({port: 0, exclusive: true}, () => {
			const address = server.address();
			server.close(() =>
				typeof address === 'object' && address
					? resolve(address.port)
					: reject(new Error('no port')),
			);
		});
	});
}

/**
 * The port an e2e server listens on, written back to `env[name]`.
 *
 * - `env[name]` set: that port, as given. If it is busy the run fails (`reuseExistingServer` is
 *   false), naming it: a port someone chose is never silently replaced.
 * - unset: `preferred` when it is free, else any free port, so another run on the machine holding
 *   the default never fails this one.
 *
 * Writing the choice back matters: Playwright evaluates the config again in each worker, and the
 * workers inherit the environment, so every evaluation (and every test file importing the URLs)
 * reads the port chosen once instead of choosing again.
 */
export async function e2ePort(
	env: Record<string, string | undefined>,
	name: string,
	preferred: number,
): Promise<number> {
	const given = env[name];
	if (given) return Number(given);
	const port = (await isPortFree(preferred)) ? preferred : await anyFreePort();
	env[name] = String(port);
	return port;
}
