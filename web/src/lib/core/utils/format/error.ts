/**
 * Reading the wording out of a thrown value, whatever shape it arrived in.
 *
 * WHY THIS EXISTS. Plenty of failures never reach a caller as an `Error`.
 * viem's request errors, a JSON-RPC payload forwarded verbatim, the
 * `{message, cause}` this app's own polling store publishes: all of them are
 * plain objects. Two habits then throw away everything they said:
 *
 *   `String(error)`                                  -> "[object Object]"
 *   `error instanceof Error ? error.message : '...'` -> a constant
 *
 * The first is visibly useless. The second is worse, because it looks like an
 * answer: the node explained exactly what was wrong and the app reported a
 * generic failure instead. A status line reading `UNHEALTHY: [object Object]`
 * and one reading `UNHEALTHY: fetch failed` are the same bug, and neither can
 * be acted on.
 *
 * NOT A SUBSTITUTE FOR THE ERROR ITSELF. These are for SCANNING. Whatever they
 * summarise should still be kept alongside - as `cause`, or handed to the
 * console beside the line - so it arrives as the object it is and can be
 * expanded. A summary is a heading, not the report.
 */

/**
 * The `message` a value carries, from an `Error` or from anything else that
 * happens to have one. Undefined when there is genuinely none.
 *
 * Separate from {@link errorMessage} because callers disagree about what to do
 * with a thrown PRIMITIVE, and they are both right: a diagnostic trace wants to
 * see `throw 'boom'` exactly as it was thrown, while a user-facing summary must
 * not put a developer's stray string in front of a player. Only the
 * plain-object case is unambiguous, so that is what this answers.
 */
export function messageOf(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const message = (error as {message?: unknown}).message;
	return typeof message === 'string' && message !== '' ? message : undefined;
}

/**
 * A one-line summary of any thrown value, for a log line or a status field.
 *
 * Surfaces a thrown primitive as itself, which is right for a DIAGNOSTIC
 * reader: `throw 'boom'` is a real thing that happens and hiding it behind a
 * constant makes it unfindable. A user-facing summary should read
 * {@link messageOf} and keep its own wording for everything else.
 */
export function errorMessage(error: unknown, fallback: string): string {
	const message = messageOf(error);
	if (message !== undefined) return message;

	// An object with no message of its own. The CALLER's fallback beats anything
	// derivable here: `String()` gives `[object Object]` and
	// `Object.prototype.toString` only ever says `[object Error]`, neither of
	// which says what failed. The caller knows what it was attempting.
	if (typeof error === 'object' && error !== null) return fallback;

	if (error === undefined || error === null) return fallback;
	const text = String(error);
	return text === '' ? fallback : text;
}
