import {defineCapability} from './define';

/**
 * Where the document is, and which build it is, for the things that must know
 * during SERVER RENDERING.
 *
 * Deliberately not the navigation capability, and the difference is the whole
 * reason this exists. `NavigationService` is about history: entries, tokens,
 * traversal, all of it browser-only, and it stays inert until the app has
 * hydrated (see ADR-0004 on the `work` branch). Page metadata cannot wait for
 * that: a canonical URL that appears only after hydration is a canonical URL no
 * crawler ever sees.
 *
 * So this answers the simpler question, is answerable on the server, and is
 * supplied as GETTERS: reading one inside a component tracks whatever reactive
 * source the app root wired it to.
 */
export type DocumentLocation = {
	/** Path of the page being rendered, e.g. `/explorer/`. */
	pathname: () => string;
	/**
	 * Build identifier, for a `version` meta tag. Useful for telling which build
	 * a bug report came from.
	 */
	version: () => string;
};

const documentLocationCapability = defineCapability<DocumentLocation>(
	'document-location',
	{
		// A standalone component still renders: it just describes itself as being
		// at the root of an unnamed build, which is the honest answer when nobody
		// has said otherwise.
		fallback: () => ({pathname: () => '/', version: () => 'unknown'}),
	},
);

export const provideDocumentLocation = documentLocationCapability.provide;
export const useDocumentLocation = documentLocationCapability.use;
