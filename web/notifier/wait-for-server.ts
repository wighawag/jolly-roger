/**
 * Waits until a server answers HTTP at all (any status), for the dev stack's
 * panes that start together (QA F12): the trigger service reads the indexer's
 * feed (`etherfold run`, its own pane) and used to start polling before the
 * indexer listened, so every `pnpm start` opened with one `fetch failed`
 * (ConnectTimeoutError) in the "notifier (trigger service)" pane.
 *
 * Each attempt is bounded (`attemptMs`), so a port that accepts and does not
 * answer yet is retried rather than waited on for a socket's full timeout.
 * It says once that it is waiting, and once that the server answered.
 */
export type WaitOptions = {
	/** between attempts */
	intervalMs?: number;
	/** each attempt's own limit */
	attemptMs?: number;
	signal?: AbortSignal;
	log?: (line: string) => void;
	fetch?: typeof fetch;
};

export async function waitForServer(
	url: string,
	name: string,
	options: WaitOptions = {},
): Promise<boolean> {
	const doFetch = options.fetch ?? fetch;
	const intervalMs = options.intervalMs ?? 1000;
	const attemptMs = options.attemptMs ?? 2000;
	const log = options.log ?? ((line: string) => console.log(line));
	let said = false;
	while (!options.signal?.aborted) {
		try {
			const response = await doFetch(url, {
				signal: AbortSignal.timeout(attemptMs),
			});
			await response.body?.cancel();
			if (said) log(`${name} answers on ${url}`);
			return true;
		} catch {
			if (!said) {
				log(`waiting for ${name} on ${url} ...`);
				said = true;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return false;
}
