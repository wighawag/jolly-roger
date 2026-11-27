/**
 * THE NOTIFIER'S SERVICES (three, and missiv from `with/messaging`), for the dev stack and the e2e: bundled by
 * `build.mjs` into `.generated/serve.js`, then
 *
 *   node notifier/.generated/serve.js push       push-notification-server (its Node.js platform)
 *   node notifier/.generated/serve.js index      `etherfold run` of the greetings' processor
 *   node notifier/.generated/serve.js triggers   the trigger service, following that indexer
 *   node notifier/.generated/serve.js missiv     missiv (`with/messaging`): the chat room and direct messages
 *   node notifier/.generated/serve.js all        the four, in one process group
 *
 * Each is the published package, configured here: `createNodeServer` from
 * @push-notification/cli, the `etherfold` command, and `createNodeService`
 * from @etherfold/platform-nodejs-triggers with the app's own trigger
 * definitions (`$lib/onchain/notifier/greetings`), bundled in. One thing is
 * added, which is why this is not the services' own commands: a RECORDING push
 * sender when NOTIFIER_PUSH_RECORDING is set (the e2e): a push is kept, not
 * sent to the browser's push service, and listed at `GET /recorded`, so a test
 * can deliver it to the worker itself. (The trigger service's registration API
 * answers CORS for the app's origin itself since @etherfold/triggers 0.2.)
 *
 * The trigger service hosts its apps by name (@etherfold/triggers 0.3): this
 * one is `greetings`, the indexer's name, so its registration API is at
 * `/greetings/...` and the app's PUBLIC_NOTIFIER names that prefix. Its
 * database is keyed by app since 0.3, and one written by an older service is
 * refused at start: `pnpm notifier:reset` starts it empty.
 *
 * Configuration is the environment (defaults are the dev stack's), plus
 * `notifier/.env.local`, the dev keys `keys.mjs` writes. The services' own
 * logs (a push the browser's push service refused, with its status and body)
 * print at warn and above: `NOTIFIER_LOG_LEVEL` and `NOTIFIER_LOG`, see
 * `log-sink.ts`.
 */
// FIRST: the services' loggers are made as their modules load (log-sink.ts)
import './log-sink.js';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNodeServer} from '@push-notification/cli';
import {
	createNodeService,
	defineConfig,
	delegatedIdentityVerifier,
	pushAction,
} from '@etherfold/platform-nodejs-triggers';
import {greetingTriggers} from '$lib/onchain/notifier/greetings';
import {createNodeServer as createMissivServer} from 'missiv';
import {waitForServer} from './wait-for-server';

const here = path.dirname(fileURLToPath(import.meta.url)); // notifier/.generated
const notifier = path.join(here, '..');
const web = path.join(notifier, '..');

function loadEnvFile(file: string) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
		if (match && process.env[match[1]] === undefined) {
			process.env[match[1]] = match[2];
		}
	}
}
const keysFile = path.join(notifier, '.env.local');
loadEnvFile(keysFile);
// the trigger service's pane starts beside the push server's, which writes the
// keys (`keys.mjs`): wait for them rather than race it
for (const [service, name] of [
	['triggers', 'NOTIFIER_PUSH_TOKEN'],
	['missiv', 'NOTIFIER_MISSIV_PUSH_TOKEN'],
] as const) {
	if (process.argv[2] === service && !process.env[name]) {
		console.log(`waiting for ${name} in ${keysFile} ...`);
		while (!process.env[name]) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			loadEnvFile(keysFile);
		}
	}
}

const env = process.env;
const HOST = env.NOTIFIER_HOST ?? 'localhost';
const APP_ORIGIN = env.NOTIFIER_APP_ORIGIN ?? 'http://localhost:5173';
const RPC_URL = env.NOTIFIER_RPC_URL ?? 'http://127.0.0.1:8545';
const PUSH_PORT = Number(env.NOTIFIER_PUSH_PORT ?? 34005);
const INDEXER_PORT = Number(env.NOTIFIER_INDEXER_PORT ?? 34002);
const TRIGGERS_PORT = Number(env.NOTIFIER_TRIGGERS_PORT ?? 34006);
const MISSIV_PORT = Number(env.NOTIFIER_MISSIV_PORT ?? 34007);
const DATA = env.NOTIFIER_DATA ?? path.join(notifier, '.data');
const INTERVAL_MS = Number(env.NOTIFIER_INTERVAL_MS ?? 2000);
const PUSH_TOKEN = env.NOTIFIER_PUSH_TOKEN ?? '';
const MISSIV_PUSH_TOKEN = env.NOTIFIER_MISSIV_PUSH_TOKEN ?? '';
const INDEXER = 'greetings';

function required(name: string, value: string | undefined) {
	if (!value) {
		throw new Error(
			`${name} is not set: run \`pnpm notifier:keys\` (it writes notifier/.env.local)`,
		);
	}
	return value;
}

type Handler = (request: Request) => Response | Promise<Response>;

/** A fetch handler on a Node HTTP server, with no framework in between. */
function listen(name: string, port: number, handler: Handler) {
	const server = http.createServer(async (req, res) => {
		try {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const headers = new Headers();
			for (const [key, value] of Object.entries(req.headers)) {
				if (typeof value === 'string') headers.set(key, value);
				else if (Array.isArray(value)) headers.set(key, value.join(', '));
			}
			const method = req.method ?? 'GET';
			const response = await handler(
				new Request(
					`http://${req.headers.host ?? `${HOST}:${port}`}${req.url}`,
					{
						method,
						headers,
						body:
							method === 'GET' || method === 'HEAD'
								? undefined
								: Buffer.concat(chunks),
					},
				),
			);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch (error) {
			console.error(`${name}:`, error);
			res.writeHead(500);
			res.end();
		}
	});
	server.listen(port, HOST, () =>
		console.log(`${name} on http://${HOST}:${port}`),
	);
	return server;
}

const sha256Hex = (text: string) =>
	createHash('sha256').update(text).digest('hex');

async function servePush() {
	const recording = !!env.NOTIFIER_PUSH_RECORDING;
	const recorded: {endpoint: string; payload: unknown; at: number}[] = [];
	const app = await createNodeServer({
		db: recording ? ':memory:' : `file:${path.join(DATA, 'push.db')}`,
		env: {
			VAPID_PUBLIC_KEY: required(
				'NOTIFIER_VAPID_PUBLIC_KEY',
				env.NOTIFIER_VAPID_PUBLIC_KEY,
			),
			VAPID_PRIVATE_KEY: required(
				'NOTIFIER_VAPID_PRIVATE_KEY',
				env.NOTIFIER_VAPID_PRIVATE_KEY,
			),
			VAPID_SUBJECT: env.NOTIFIER_VAPID_SUBJECT,
			// the trigger service's token, for this app only, and missiv's
			// (`with/messaging`: a direct message pushed to its recipient), when set
			PUSH_TOKENS: [
				required('NOTIFIER_PUSH_TOKEN', PUSH_TOKEN),
				MISSIV_PUSH_TOKEN,
			]
				.filter((token) => token)
				.map((token) => `${APP_ORIGIN}:${sha256Hex(token)}`)
				.join(','),
		},
		...(recording
			? {
					getPushSender: () => async (subscription, payload) => {
						recorded.push({
							endpoint: subscription.endpoint,
							payload: JSON.parse(String(payload)),
							at: Date.now(),
						});
						return {ok: true, status: 201};
					},
				}
			: {}),
	});
	listen(
		recording
			? 'push-notification-server (recording)'
			: 'push-notification-server',
		PUSH_PORT,
		(request) =>
			recording && new URL(request.url).pathname === '/recorded'
				? Response.json(recorded)
				: app.fetch(request),
	);
}

/**
 * missiv (`with/messaging`), its Node.js platform: the HTTP API, the rooms'
 * sockets and the live inbox's (missiv 0.6: one socket per account, polling
 * `inbox/changes` as its fallback) on one port, a new direct message pushed to
 * its recipient through the push server above, with missiv's own token for this
 * app's domain (its host). Its session tokens are signed with
 * NOTIFIER_MISSIV_SESSION_SECRET, or a secret made at each start: a client whose
 * token a restart invalidated opens a new session, once, by itself.
 */
async function serveMissiv() {
	const {app, injectWebSocket} = await createMissivServer({
		db: `file:${path.join(DATA, 'missiv.db')}`,
		env: {
			SESSION_SECRET:
				env.NOTIFIER_MISSIV_SESSION_SECRET ??
				randomBytes(32).toString('base64url'),
			PUSH_SERVER_URL: `http://${HOST}:${PUSH_PORT}`,
			PUSH_TOKENS: MISSIV_PUSH_TOKEN
				? `${new URL(APP_ORIGIN).host}=${MISSIV_PUSH_TOKEN}`
				: '',
		},
	});
	const server = listen('missiv', MISSIV_PORT, (request) => app.fetch(request));
	injectWebSocket(server);
}

function serveIndexer(): ChildProcess {
	const bin = path.join(web, 'node_modules', '.bin', 'etherfold');
	const child = spawn(
		bin,
		[
			'run',
			'-p',
			path.join(here, 'processor.bundle.js'),
			'--store',
			'sqlite',
			'--db',
			`file:${path.join(DATA, 'greetings.db')}`,
			'-n',
			RPC_URL,
			'--port',
			String(INDEXER_PORT),
			'--host',
			HOST,
			'--indexer',
			INDEXER,
			// a dev stack iterates on its handlers: a new bundle answers at once
			'--promotion',
			'immediate',
			'--override',
		],
		{
			stdio: 'inherit',
			env: {
				...env,
				INDEXING_SOURCE: readFileSync(path.join(here, 'source.json'), 'utf8'),
			},
		},
	);
	child.on('exit', (code) => {
		console.log(`etherfold run exited (${code})`);
		process.exitCode = code ?? 1;
	});
	return child;
}

async function serveTriggers(signal: AbortSignal) {
	// the indexer is another pane, started at the same time: read its feed once
	// it listens, not before (QA F12)
	if (
		!(await waitForServer(`http://${HOST}:${INDEXER_PORT}/`, 'the indexer', {
			signal,
		}))
	) {
		return;
	}
	const source = JSON.parse(
		readFileSync(path.join(here, 'source.json'), 'utf8'),
	);
	const origin =
		env.NOTIFIER_TRIGGERS_ORIGIN ?? `http://${HOST}:${TRIGGERS_PORT}`;
	const config = defineConfig({
		database: `file:${path.join(DATA, 'triggers.db')}`,
		intervalMs: INTERVAL_MS,
		apps: {
			// the app's name, the prefix of its routes: `/greetings/subscriptions`, ...
			[INDEXER]: {
				chainId: source.chainId,
				etherfold: {url: `http://${HOST}:${INDEXER_PORT}`, indexer: INDEXER},
				gate: {rpcUrl: RPC_URL, depth: 0},
				triggers: greetingTriggers(source.contracts[0].address),
				actions: {
					push: pushAction({
						url: `http://${HOST}:${PUSH_PORT}/api`,
						domain: APP_ORIGIN,
						token: required('NOTIFIER_PUSH_TOKEN', PUSH_TOKEN),
					}),
				},
				verifier: delegatedIdentityVerifier({
					serverOrigin: origin,
					domain: APP_ORIGIN,
				}),
			},
		},
	});
	const service = await createNodeService(config);
	const server = listen(
		'trigger service',
		TRIGGERS_PORT,
		// every app's routes under `/{app}/`, CORS for each app's origin its own
		// (@etherfold/triggers 0.2: the verifier's app)
		(request) => service.api!.fetch(request),
	);
	try {
		await service.run({
			signal,
			intervalMs: INTERVAL_MS,
			onError: (app, error) =>
				console.error(`trigger service (${app}):`, error),
		});
	} finally {
		server.close();
		service.close();
	}
}

const which = process.argv[2] ?? 'all';
mkdirSync(DATA, {recursive: true});
const controller = new AbortController();
const children: ChildProcess[] = [];
for (const name of ['SIGINT', 'SIGTERM'] as const) {
	process.once(name, () => {
		controller.abort();
		for (const child of children) child.kill('SIGTERM');
		setTimeout(() => process.exit(0), 500).unref();
	});
}
if (which === 'push' || which === 'all') await servePush();
if (which === 'missiv' || which === 'all') await serveMissiv();
if (which === 'index' || which === 'all') children.push(serveIndexer());
if (which === 'triggers' || which === 'all') {
	await serveTriggers(controller.signal);
} else if (!['push', 'index', 'missiv', 'all'].includes(which)) {
	console.error(
		`unknown service ${which}: push, index, triggers, missiv or all`,
	);
	process.exit(2);
}
