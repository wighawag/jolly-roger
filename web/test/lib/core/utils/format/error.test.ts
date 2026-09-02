import {describe, it, expect} from 'vitest';
import {
	errorMessage,
	messageOf,
} from '../../../../../src/lib/core/utils/format/error';

/**
 * The two habits this replaces, and why each one is a bug:
 *
 *   `String(error)`                                  -> "[object Object]"
 *   `error instanceof Error ? error.message : '...'` -> a constant
 *
 * Both destroy the wording a plain-object failure arrived with, and plain
 * objects are most of them: viem request errors, raw JSON-RPC payloads, the
 * polling store's own `{message, cause}`.
 */

describe('messageOf', () => {
	it('reads the message off a plain object, which is the whole point', () => {
		// The case both old habits lost. Not an `Error`, has a perfectly good
		// sentence, and the app used to report a constant instead.
		expect(messageOf({message: 'nonce too low'})).toBe('nonce too low');
	});

	it('reads it off an Error too', () => {
		expect(messageOf(new Error('reverted'))).toBe('reverted');
	});

	it('has no answer for a primitive, and says so rather than guessing', () => {
		// Undefined rather than `String(value)`, because callers legitimately
		// disagree about a thrown primitive: a trace wants it verbatim, a toast
		// must not show it. Answering here would make that choice for both.
		expect(messageOf('boom')).toBeUndefined();
		expect(messageOf(42)).toBeUndefined();
		expect(messageOf(undefined)).toBeUndefined();
		expect(messageOf(null)).toBeUndefined();
	});

	it('ignores a message that is present but useless', () => {
		// An empty string is not wording; treating it as one produces a status
		// line with nothing after the colon.
		expect(messageOf({message: ''})).toBeUndefined();
		expect(messageOf({message: 123})).toBeUndefined();
		expect(messageOf({})).toBeUndefined();
	});
});

describe('errorMessage', () => {
	it('prefers the value\u2019s own wording to the caller\u2019s fallback', () => {
		expect(errorMessage({message: 'node is behind'}, 'fetch failed')).toBe(
			'node is behind',
		);
	});

	it('falls back for an object that carries no wording', () => {
		// `[object Object]` is what this branch exists to never produce.
		expect(errorMessage({code: -32603}, 'fetch failed')).toBe('fetch failed');
		expect(errorMessage({code: -32603}, 'fetch failed')).not.toContain(
			'object Object',
		);
	});

	it('surfaces a thrown primitive as itself, for a reader that wants it', () => {
		// The diagnostic case: `throw 'boom'` is a real thing that happens, and
		// hiding it behind the fallback makes it unfindable.
		expect(errorMessage('boom', 'fetch failed')).toBe('boom');
		expect(errorMessage(42, 'fetch failed')).toBe('42');
	});

	it('falls back for the values that carry nothing at all', () => {
		expect(errorMessage(undefined, 'fetch failed')).toBe('fetch failed');
		expect(errorMessage(null, 'fetch failed')).toBe('fetch failed');
		expect(errorMessage('', 'fetch failed')).toBe('fetch failed');
	});
});
