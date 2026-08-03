/**
 * Capabilities: optional, independently-constructable enhancements that an app
 * root *provides* and descendant components *use*.
 *
 * A capability is deliberately NOT the app context (see the ADR:
 * `docs/adr/0001-capabilities-vs-app-context.md`, and `./README.md`). Short
 * version:
 *
 * - Capability: one small, independently-constructable thing (a route resolver,
 *   an ENS service). Injected on its own key, usually optional or with a
 *   fallback, always synchronous. A standalone component depending only on a
 *   capability can run in *any* app that provides it (or not, if it falls back).
 *
 * - App context (`getAppContext`): the app's composed, required runtime
 *   (connection, wallet client, account data, stores, ...). One key, many
 *   members, one lifecycle, built asynchronously at the root. Components that
 *   read it are app-specific (or specific to a slice of that runtime).
 *
 * `defineCapability` is the shared primitive so every capability follows the
 * same provide/use shape with a typed key.
 */
import {getContext, setContext} from 'svelte';

// Dev-only guard: two capabilities defined with the same label would share the
// same global Symbol.for slot and silently collide. We warn (dev only) rather
// than throw, so a stray duplicate never breaks production.
//
// The registry is reset on HMR dispose so that re-evaluating a capability
// module during hot-reload does not spuriously report its own label as a
// duplicate (a real duplicate is two *different* modules using the same label,
// which still gets caught on a full load).
const registeredLabels = new Set<string>();
if (import.meta.env.DEV && import.meta.hot) {
	import.meta.hot.dispose(() => registeredLabels.clear());
}

/** A capability that may be absent; `use()` returns `T | undefined`. */
export type OptionalCapability<T> = {
	provide(value: T): void;
	use(): T | undefined;
};

/** A capability with a fallback; `use()` always returns a `T`. */
export type FallbackCapability<T> = {
	provide(value: T): void;
	use(): T;
};

/** A capability that must be provided; `use()` throws when absent. */
export type RequiredCapability<T> = {
	provide(value: T): void;
	use(): T;
};

/**
 * Define an optional capability. `use()` returns `undefined` when no provider
 * is present, so consumers must handle absence (the capability is a pure
 * enhancement, e.g. ENS name resolution).
 */
export function defineCapability<T>(label: string): OptionalCapability<T>;
/**
 * Define a capability with a fallback. `use()` returns the provided value, or
 * the fallback's result when absent, so it always yields a usable `T`
 * (e.g. route resolution falling back to base-path-only resolution).
 */
export function defineCapability<T>(
	label: string,
	options: {fallback: () => T},
): FallbackCapability<T>;
/**
 * Define a required capability. `use()` throws when no provider is present,
 * for capabilities that have no meaningful default and whose absence is a bug.
 */
export function defineCapability<T>(
	label: string,
	options: {required: true},
): RequiredCapability<T>;
export function defineCapability<T>(
	label: string,
	options?: {fallback?: () => T; required?: boolean},
): OptionalCapability<T> | FallbackCapability<T> | RequiredCapability<T> {
	// Symbol.for keeps the key stable across module instances (HMR, bundling)
	// while staying private to callers, who go through the typed helpers.
	const KEY = Symbol.for(`capability:${label}`);

	if (import.meta.env.DEV) {
		if (registeredLabels.has(label)) {
			console.warn(
				`[capabilities] Duplicate capability label "${label}": two ` +
					`definitions share the same context key and will collide. ` +
					`Use a unique label.`,
			);
		}
		registeredLabels.add(label);
	}

	function provide(value: T): void {
		setContext(KEY, value);
	}

	function use(): T | undefined {
		// `undefined` is the "not provided" sentinel: a provider that sets a
		// literal `undefined` is indistinguishable from no provider and will take
		// the fallback/throw path. Capabilities should therefore be non-undefined
		// values (services/objects/functions), which all current ones are.
		const value = getContext<T | undefined>(KEY);
		if (value !== undefined) return value;
		if (options?.fallback) return options.fallback();
		if (options?.required) {
			throw new Error(
				`Capability "${label}" was used but no provider is present. ` +
					`Call the matching provide*() at the app root.`,
			);
		}
		return undefined;
	}

	return {provide, use} as
		OptionalCapability<T> | FallbackCapability<T> | RequiredCapability<T>;
}
