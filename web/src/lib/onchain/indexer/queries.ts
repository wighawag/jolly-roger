/**
 * THE QUESTION THE APP ASKS of the greetings' indexed state, as GraphQL over
 * the schema etherfold builds from `./processor.ts`'s entities: one PART,
 * `counts`, every account's greeting count, for `$lib/indexer`'s follower.
 */
import {
	StateQueryError,
	type BlockRef,
	type Execute,
	type StateFollowerSpec,
	type StateRead,
} from '$lib/indexer/follower';

/** What the indexed state holds: each account's greeting count, keyed lower-case. */
export type GreetingCounts = {counts: ReadonlyMap<string, number>};

export type Part = 'counts';

/**
 * How many rows the list asks for. A CAP, not a cost: a list that comes back
 * FULL is refused rather than taken as the whole set, because GraphQL's
 * `first` cuts silently.
 */
export const LIST_LIMIT = 20_000;

export function countsDocument(pinned: boolean): string {
	return pinned
		? `query GreetingCounts($block: BlockAddress!) {\n\tgreeter(first: ${LIST_LIMIT}, block: $block) { account greetings }\n}`
		: `query GreetingCounts {\n\tgreeter(first: ${LIST_LIMIT}) { account greetings }\n}`;
}

/** Ask the counts as of one block (the tip when `at` is left out). */
export async function readCounts(
	execute: Execute,
	options: {at?: number | BlockRef} = {},
): Promise<StateRead<GreetingCounts>> {
	const at = options.at;
	const result = await execute({
		query: countsDocument(at !== undefined),
		variables:
			at === undefined
				? {}
				: {block: typeof at === 'number' ? {number: at} : {hash: at.hash}},
	});
	if (result.errors && result.errors.length > 0) {
		const first = result.errors[0];
		const code =
			typeof first.extensions?.code === 'string'
				? first.extensions.code
				: undefined;
		throw new StateQueryError(
			`${code ? `${code}: ` : ''}${first.message}`,
			code,
		);
	}
	const rows = (
		result.data as {greeter: {account: string; greetings: number}[]}
	).greeter;
	if (rows.length >= LIST_LIMIT) {
		throw new StateQueryError(
			`the greeters answered ${rows.length} rows, the limit asked for: a cut list is not every account`,
			'list-limit-reached',
		);
	}
	const counts = new Map<string, number>();
	for (const row of rows) {
		counts.set(row.account.toLowerCase(), Number(row.greetings));
	}
	// Pinned, the fields are as of `at`; unpinned, as of the operation's pin.
	if (at !== undefined && typeof at !== 'number') {
		return {
			data: {counts},
			block: at.number,
			blockHash: at.hash,
			generation: result.extensions?.generation,
		};
	}
	return {
		data: {counts},
		block: at ?? result.extensions?.block ?? undefined,
		blockHash:
			at === undefined
				? (result.extensions?.blockHash ?? undefined)
				: undefined,
		generation: result.extensions?.generation,
	};
}

/** The counts, for `$lib/indexer`'s follower. No part depends on who reads. */
export const countsFollower: StateFollowerSpec<Part, GreetingCounts> = {
	parts: ['counts'],
	partOf: {greeter: 'counts'},
	read: (execute, _parts, {at}) => readCounts(execute, {at}),
};
