/**
 * THE ENTRY THE PROCESSOR BUNDLE IS BUILT FROM, for `etherfold run` in the
 * notifier's stack (`web/notifier/build.mjs`): one self-contained file
 * exporting `createProcessor`, the shape `etherfold run -p` takes (its bytes
 * are the processor's identity, etherfold ADR-0086). The tab does not run it:
 * its worker folds `./processor` directly, and this node publishes nothing.
 *
 * It hands back the AUTHORING object and names no store and no contract: what
 * to index is the source, given to `etherfold run` as `INDEXING_SOURCE`.
 */
import {greetingsProcessor} from './processor';

export const createProcessor = () => greetingsProcessor;
