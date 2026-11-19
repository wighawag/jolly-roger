/**
 * THE NOTIFIER'S THREE SERVICES, for the dev stack and the e2e: bundled by
 * `build.mjs` into `.generated/serve.js`, then
 *
 *   node notifier/.generated/serve.js push       push-notification-server (its Node.js platform)
 *   node notifier/.generated/serve.js index      `etherfold run` of the greetings' processor
 *   node notifier/.generated/serve.js triggers   the trigger service, following that indexer
 *   node notifier/.generated/serve.js all        the three, in one process group
 *
 * Each is the published package, configured here: `createNodeServer` from
 * @push-notification/cli, the `etherfold` command, and `createNodeService`
 * from @etherfold/platform-nodejs-triggers with the app's own trigger
 * definitions (`$lib/onchain/notifier/greetings`). Two things are added around
 * them, which is why this is not the services' own commands:
 *
 * - CORS on the trigger service's registration API, for the app's origin only:
 *   the browser registers its trigger there directly, and the API serves no
 *   CORS of its own (as of @etherfold/triggers 0.1.0);
 * - a RECORDING push sender when NOTIFIER_PUSH_RECORDING is set (the e2e): a
 *   push is kept, not sent to the browser's push service, and listed at
 *   `GET /recorded`, so a test can deliver it to the worker itself.
 *
 * Configuration is the environment (defaults are the dev stack's), plus
 * `notifier/.env.local`, the dev keys `keys.mjs` writes.
 */
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
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
if (process.argv[2] === 'triggers' && !process.env.NOTIFIER_PUSH_TOKEN) {
	console.log(`waiting for NOTIFIER_PUSH_TOKEN in ${keysFile} ...`);
	while (!process.env.NOTIFIER_PUSH_TOKEN) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		loadEnvFile(keysFile);
	}
}

const env = process.env;
const HOST = env.NOTIFIER_HOST ?? 'localhost';
const APP_ORIGIN = env.NOTIFIER_APP_ORIGIN ?? 'http://localhost:5173';
const RPC_URL = env.NOTIFIER_RPC_URL ?? 'http://127.0.0.1:8545';
const PUSH_PORT = Number(env.NOTIFIER_PUSH_PORT ?? 34005);
const INDEXER_PORT = Number(env.NOTIFIER_INDEXER_PORT ?? 34002);
const TRIGGERS_PORT = Number(env.NOTIFIER_TRIGGERS_PORT ?? 34006);
const DATA = env.NOTIFIER_DATA ?? path.join(notifier, '.data');
const INTERVAL_MS = Number(env.NOTIFIER_INTERVAL_MS ?? 2000);
const PUSH_TOKEN = env.NOTIFIER_PUSH_TOKEN ?? '';
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

/** CORS for ONE origin, the app's: a preflight answered, every answer marked. */
function withCors(origin: string, handler: Handler): Handler {
	const cors = {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': 'POST, GET, OPTIONS',
		'access-control-allow-headers': 'content-type, signature',
		'access-control-max-age': '600',
		vary: 'origin',
	};
	return async (request) => {
		if (request.method === 'OPTIONS') {
			return new Response(null, {status: 204, headers: cors});
		}
		const response = await handler(request);
		const headers = new Headers(response.headers);
		for (const [key, value] of Object.entries(cors)) headers.set(key, value);
		return new Response(response.body, {status: response.status, headers});
	};
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
			// the trigger service's token, for this app only
			PUSH_TOKENS: `${APP_ORIGIN}:${sha256Hex(required('NOTIFIER_PUSH_TOKEN', PUSH_TOKEN))}`,
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
	const source = JSON.parse(
		readFileSync(path.join(here, 'source.json'), 'utf8'),
	);
	const origin =
		env.NOTIFIER_TRIGGERS_ORIGIN ?? `http://${HOST}:${TRIGGERS_PORT}`;
	const config = defineConfig({
		name: INDEXER,
		chainId: source.chainId,
		database: `file:${path.join(DATA, 'triggers.db')}`,
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
		intervalMs: INTERVAL_MS,
	});
	const {service, close} = await createNodeService(config);
	const server = listen(
		'trigger service',
		TRIGGERS_PORT,
		withCors(APP_ORIGIN, (request) => service.api!.fetch(request)),
	);
	try {
		await service.run({
			signal,
			intervalMs: INTERVAL_MS,
			onError: (error) => console.error('trigger service:', error),
		});
	} finally {
		server.close();
		close();
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
if (which === 'index' || which === 'all') children.push(serveIndexer());
if (which === 'triggers' || which === 'all') {
	await serveTriggers(controller.signal);
} else if (!['push', 'index', 'all'].includes(which)) {
	console.error(`unknown service ${which}: push, index, triggers or all`);
	process.exit(2);
}
