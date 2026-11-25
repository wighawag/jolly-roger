/**
 * The console sink `log-sink.ts` installs for the notifier's services: a
 * `named-logs` factory, by level and logger name. Pure, so a test can build
 * one without installing it.
 */
const LEVELS: Record<string, number> = {
	error: 1,
	warn: 2,
	info: 3,
	log: 4,
	debug: 5,
	trace: 6,
};

/** The level a setting names, or the default (warn). */
export function logLevel(setting: string | undefined): number {
	if (!setting) return LEVELS.warn;
	return LEVELS[setting.toLowerCase()] ?? (Number(setting) || LEVELS.warn);
}

/** Whether a logger prints, by `NOTIFIER_LOG`'s patterns (all, when unset). */
export function loggerEnabled(name: string, patterns: string | undefined) {
	const list = (patterns ?? '*').split(/[\s,]+/).filter(Boolean);
	const matches = (pattern: string) =>
		new RegExp(
			`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
		).test(name);
	if (list.some((p) => p.startsWith('-') && matches(p.slice(1)))) return false;
	return list.some((p) => !p.startsWith('-') && matches(p));
}

type Method =
	| 'assert'
	| 'error'
	| 'warn'
	| 'info'
	| 'log'
	| 'debug'
	| 'trace'
	| 'dir'
	| 'table'
	| 'time'
	| 'timeEnd'
	| 'timeLog'
	| 'write';

const METHOD_LEVEL: Record<Method, number> = {
	assert: 1,
	error: 1,
	warn: 2,
	info: 3,
	write: 3,
	log: 4,
	debug: 5,
	dir: 5,
	table: 5,
	time: 5,
	timeEnd: 5,
	timeLog: 5,
	trace: 6,
};

const noop = () => {};

/** A named-logs factory writing to `out` (the console), by level and name. */
export function consoleLogFactory(
	settings: {level?: string; names?: string},
	out: Pick<
		Console,
		'error' | 'warn' | 'info' | 'log' | 'debug' | 'trace'
	> = console,
) {
	const level = logLevel(settings.level);
	return (name: string) => {
		const on = loggerEnabled(name, settings.names);
		const to = (method: Method) => {
			if (!on || METHOD_LEVEL[method] > level) return noop;
			const sink =
				method === 'assert' || method === 'error'
					? out.error
					: method === 'warn'
						? out.warn
						: method === 'info' || method === 'write'
							? out.info
							: method === 'log'
								? out.log
								: method === 'trace'
									? out.trace
									: out.debug;
			if (method === 'assert') {
				return (condition?: unknown, ...args: unknown[]) => {
					if (!condition) sink.call(out, `[${name}] assertion failed`, ...args);
				};
			}
			return (...args: unknown[]) => sink.call(out, `[${name}]`, ...args);
		};
		return Object.fromEntries(
			(Object.keys(METHOD_LEVEL) as Method[]).map((method) => [
				method,
				to(method),
			]),
		);
	};
}
