/**
 * THE GREETINGS' INDEXER WORKER: their processor, hosted by the framework
 * (`$lib/indexer/host`). A file of the app's because the bundler has to see the
 * processor's import here, and `./counts.ts` starts it with a literal
 * `new Worker(new URL(...))`. No snapshot is published (a demo's history is
 * short), so the processor is imported rather than fetched as a bundle.
 *
 * ONE ENTRY, the live chain's: this node has no chain in the tab, so no world
 * entry (`hostWorldIndexer`); an app that has one adds it beside this one.
 */
import {hostLiveIndexer} from '$lib/indexer/host';
import {greetingsProcessor} from './processor';
import {INDEXER_PREFIX, STREAM_FINALITY} from './source';

hostLiveIndexer({
	processor: greetingsProcessor,
	databasePrefix: INDEXER_PREFIX,
	finality: STREAM_FINALITY,
});
