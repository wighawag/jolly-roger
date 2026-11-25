// Builds what the notifier's three services run, into notifier/.generated/:
//
// - processor.bundle.js: the greetings' processor as one self-contained file
//   (`src/lib/onchain/indexer/processor.bundle.ts`), for `etherfold run -p`;
// - source.json: what to index (INDEXING_SOURCE), GreetingsRegistry's address,
//   start block and handled events, read from the contracts' deployment;
// - serve.js: `serve.ts`, the push server, the indexer and the trigger service
//   (the app's trigger definitions bundled in, the services' packages not).
//
//   node notifier/build.mjs [deployment]   (default: localhost; or NOTIFIER_DEPLOYMENT)
//
// It waits for the deployment to exist, so a dev pane can start before the
// contracts are deployed.
import {build} from 'esbuild';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '..');
const out = path.join(here, '.generated');
const deployment =
	process.argv[2] ?? process.env.NOTIFIER_DEPLOYMENT ?? 'localhost';
const deployments = path.join(
	web,
	'..',
	'contracts',
	'deployments',
	deployment,
);
const registryFile = path.join(deployments, 'GreetingsRegistry.json');

const alias = {$lib: path.join(web, 'src', 'lib')};

if (!existsSync(registryFile)) {
	console.log(`waiting for ${path.relative(process.cwd(), registryFile)} ...`);
	while (!existsSync(registryFile)) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}
mkdirSync(out, {recursive: true});

// every file lands by a rename, so the three panes building at once never read
// a half-written one
function land(file, contents) {
	const partial = `${file}.${process.pid}.partial`;
	writeFileSync(partial, contents);
	renameSync(partial, file);
}
async function bundle(options) {
	const result = await build({...options, write: false, logLevel: 'warning'});
	for (const file of result.outputFiles) land(file.path, file.contents);
}

await bundle({
	entryPoints: [path.join(web, 'src/lib/onchain/indexer/processor.bundle.ts')],
	bundle: true,
	format: 'esm',
	// as stratagems' bundle: the browser's resolution, so a package's node-only
	// half (ws) is its browser stub, and the bundle runs in a tab or in Node
	platform: 'browser',
	minify: true,
	alias,
	outfile: path.join(out, 'processor.bundle.js'),
});

// the services' log sink, its own module so serve.js loads it BEFORE the
// services' packages: their loggers are made as they load (log-sink.ts)
await bundle({
	entryPoints: [path.join(here, 'log-sink.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node22',
	outfile: path.join(out, 'log-sink.js'),
});

await bundle({
	plugins: [
		{
			name: 'log-sink-apart',
			setup(build) {
				build.onResolve({filter: /^\.\/log-sink\.js$/}, () => ({
					path: './log-sink.js',
					external: true,
				}));
			},
		},
	],
	entryPoints: [path.join(here, 'serve.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node22',
	// the services' packages are resolved from web/node_modules at run time
	packages: 'external',
	alias,
	outfile: path.join(out, 'serve.js'),
});

// what to index: the events the processor handles, as `indexingSource` does
const {createProcessor} = await import(
	pathToFileURL(path.join(out, 'processor.bundle.js')).href
);
const processor = createProcessor();
const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
const chain = JSON.parse(
	readFileSync(path.join(deployments, '.chain'), 'utf8'),
);
const source = {
	chainId: String(chain.chainId),
	...(chain.genesisHash ? {genesisHash: chain.genesisHash} : {}),
	contracts: [
		{
			abi: registry.abi.filter(
				(entry) =>
					entry.type === 'event' &&
					typeof processor[`on${entry.name}`] === 'function',
			),
			address: registry.address,
			...(registry.receipt?.blockNumber !== undefined
				? {startBlock: Number(registry.receipt.blockNumber)}
				: {}),
		},
	],
};
land(path.join(out, 'source.json'), JSON.stringify(source, null, 2));
console.log(
	`notifier built for ${deployment}: GreetingsRegistry ${registry.address} on chain ${source.chainId}`,
);
