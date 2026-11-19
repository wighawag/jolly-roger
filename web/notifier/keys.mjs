// The notifier's dev secrets, made once:
//
// - a VAPID key pair (P-256, the Web Push application server key): both halves
//   into notifier/.env.local for the push server, the PUBLIC half also into
//   web/.env.local as PUBLIC_VAPID_PUBLIC_KEY, which the app subscribes with;
// - the trigger service's token at the push server (NOTIFIER_PUSH_TOKEN).
//
//   node notifier/keys.mjs   (pnpm notifier:keys)
//
// Idempotent: a key already written is kept, since a new VAPID key orphans
// every subscription made with the old one. Both files are gitignored
// (`.env*.local`). Not for production: there, the operator configures each
// service with keys of its own.
import {generateKeyPairSync, randomBytes} from 'node:crypto';
import {existsSync, readFileSync, appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const notifierEnv = path.join(here, '.env.local');
const webEnv = path.join(here, '..', '.env.local');

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const valueOf = (text, name) =>
	new RegExp(`^${name}=\"?([^\"\\n]*)`, 'm').exec(text)?.[1];

const base64url = (bytes) => Buffer.from(bytes).toString('base64url');

let notifier = read(notifierEnv);
if (!valueOf(notifier, 'NOTIFIER_VAPID_PUBLIC_KEY')) {
	const {privateKey} = generateKeyPairSync('ec', {
		namedCurve: 'prime256v1',
	});
	const jwk = privateKey.export({format: 'jwk'});
	const point = Buffer.concat([
		Buffer.from([4]),
		Buffer.from(jwk.x, 'base64url'),
		Buffer.from(jwk.y, 'base64url'),
	]);
	appendFileSync(
		notifierEnv,
		`# written by notifier/keys.mjs: the dev stack's VAPID key pair\n` +
			`NOTIFIER_VAPID_PUBLIC_KEY=${base64url(point)}\n` +
			`NOTIFIER_VAPID_PRIVATE_KEY=${jwk.d}\n`,
	);
	console.log(
		`VAPID key pair written to ${path.relative(process.cwd(), notifierEnv)}`,
	);
}
notifier = read(notifierEnv);
if (!valueOf(notifier, 'NOTIFIER_PUSH_TOKEN')) {
	appendFileSync(
		notifierEnv,
		`# the trigger service's token at the push server\nNOTIFIER_PUSH_TOKEN=${base64url(randomBytes(24))}\n`,
	);
	console.log(
		`push token written to ${path.relative(process.cwd(), notifierEnv)}`,
	);
}

const vapidPublicKey = valueOf(read(notifierEnv), 'NOTIFIER_VAPID_PUBLIC_KEY');
const web = read(webEnv);
const already = valueOf(web, 'PUBLIC_VAPID_PUBLIC_KEY');
if (already === undefined) {
	appendFileSync(
		webEnv,
		`${web && !web.endsWith('\n') ? '\n' : ''}# the dev push server's VAPID public key (notifier/keys.mjs)\nPUBLIC_VAPID_PUBLIC_KEY=${vapidPublicKey}\n`,
	);
	console.log(
		`PUBLIC_VAPID_PUBLIC_KEY written to ${path.relative(process.cwd(), webEnv)}`,
	);
} else if (already !== vapidPublicKey) {
	console.warn(
		`web/.env.local's PUBLIC_VAPID_PUBLIC_KEY is not notifier/.env.local's: the app would subscribe against another key`,
	);
	process.exitCode = 1;
}
