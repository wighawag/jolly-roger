/**
 * JSON.stringify replacer that converts `bigint` values to plain decimal
 * strings. Use this whenever data may contain bigints (decoded event args,
 * contract return values, ...) since `JSON.stringify` throws on bigint by
 * default.
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
	return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Deep-clone a value while converting every `bigint` to its decimal string.
 * Safe alternative to `JSON.parse(JSON.stringify(value))`, which throws on
 * bigint values (e.g. viem-decoded event args).
 */
export function toPlainJson<T = unknown>(value: unknown): T {
	return JSON.parse(JSON.stringify(value, bigIntReplacer));
}
