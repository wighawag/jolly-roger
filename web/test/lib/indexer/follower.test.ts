import {describe, expect, it} from 'vitest';
import {
	BLOCK_NOT_RECORDED,
	createStateFollower,
	partsMovedBy,
	StateQueryError,
	type BlockRef,
	type Execute,
	type StateFollowerSpec,
	type StateRead,
} from '$lib/indexer/follower';

/**
 * A toy game of two parts, `a` and `b`, and one that depends on who plays,
 * `mine`. The fake `read` records every call and answers from a table of
 * values per block, so each test says what the chain holds and checks what the
 * follower asked for and published.
 */
type Part = 'a' | 'b' | 'mine';
type Data = {a?: number; b?: number; mine?: string};

type Call = {
	parts: Part[];
	account: string;
	at?: number | BlockRef;
	into?: Data;
};

function toyGame(options: {
	/** What each part holds; the read answers with the current value. */
	values: {a: number; b: number};
	tip?: {number: number; hash: string};
	fail?: (call: Call) => Error | undefined;
	/** Held until released, to test that reads are serialised. */
	gate?: () => Promise<void>;
}) {
	const calls: Call[] = [];
	const spec: StateFollowerSpec<Part, Data> = {
		parts: ['a', 'b', 'mine'],
		partOf: {aRow: 'a', bRow: 'b', mineRow: 'mine'},
		accountPart: 'mine',
		read: async (_execute, parts, {account, at, into}) => {
			const call: Call = {parts: [...parts].sort(), account, at, into};
			calls.push(call);
			await options.gate?.();
			const error = options.fail?.(call);
			if (error) throw error;
			const data: Data = {...into};
			if (parts.has('a')) data.a = options.values.a;
			if (parts.has('b')) data.b = options.values.b;
			if (parts.has('mine')) data.mine = `of ${account}`;
			const tip = options.tip ?? {number: 10, hash: '0x10'};
			return at === undefined
				? {data, block: tip.number, blockHash: tip.hash}
				: typeof at === 'number'
					? {data, block: at}
					: {data, block: at.number, blockHash: at.hash};
		},
	};
	return {spec, calls};
}

const execute: Execute = async () => ({data: {}});

describe('the state follower', () => {
	it('reads every part first, as of the tip, then publishes it', async () => {
		const game = toyGame({values: {a: 1, b: 2}});
		const follower = createStateFollower(game.spec, execute, {account: 'me'});
		const reads: StateRead<Data>[] = [];
		follower.onUpdate((read) => reads.push(read));
		await follower.refreshAll();
		expect(game.calls).toEqual([
			{
				parts: ['a', 'b', 'mine'],
				account: 'me',
				at: undefined,
				into: undefined,
			},
		]);
		expect(reads).toHaveLength(1);
		expect(follower.state).toEqual({
			data: {a: 1, b: 2, mine: 'of me'},
			block: 10,
			blockHash: '0x10',
		});
	});

	it('re-reads only the parts an applied block moved, pinned by the block HASH, into the state it holds', async () => {
		const values = {a: 1, b: 2};
		const game = toyGame({values});
		const follower = createStateFollower(game.spec, execute, {account: 'me'});
		await follower.refreshAll();
		// the first signal names a coherence the follower does not hold: everything
		await follower.moved({
			kind: 'applied',
			block: 11,
			hash: '0x11',
			coherence: 'c1',
			entities: ['aRow'],
		});
		expect(game.calls[1].parts).toEqual(['a', 'b', 'mine']);
		values.a = 5;
		await follower.moved({
			kind: 'applied',
			block: 12,
			hash: '0x12',
			coherence: 'c1',
			entities: ['aRow'],
		});
		expect(game.calls[2]).toMatchObject({
			parts: ['a'],
			at: {number: 12, hash: '0x12'},
			into: {a: 1, b: 2, mine: 'of me'},
		});
		expect(follower.state).toEqual({
			data: {a: 5, b: 2, mine: 'of me'},
			block: 12,
			blockHash: '0x12',
		});
	});

	it('an entity it does not know, a retraction or a new coherence token reads everything again', async () => {
		const game = toyGame({values: {a: 1, b: 2}});
		const follower = createStateFollower(game.spec, execute);
		await follower.refreshAll();
		await follower.moved({
			kind: 'applied',
			block: 11,
			hash: '0x11',
			coherence: 'c1',
			entities: [],
		});
		await follower.moved({
			kind: 'applied',
			block: 12,
			hash: '0x12',
			coherence: 'c1',
			entities: ['unknown'],
		});
		await follower.moved({kind: 'retracted', coherence: 'c1'});
		await follower.moved({
			kind: 'applied',
			block: 13,
			hash: '0x13',
			coherence: 'c2',
			entities: ['aRow'],
		});
		expect(game.calls.map((c) => c.parts.length)).toEqual([3, 3, 3, 3, 3]);
		// an unknown entity is still an applied block: every part, pinned to it
		expect(game.calls.map((c) => c.at)).toEqual([
			undefined,
			undefined,
			{number: 12, hash: '0x12'},
			undefined,
			undefined,
		]);
	});

	it('a pinned block that a reorg replaced is read again at the tip, and nobody is told', async () => {
		let refuse = true;
		const game = toyGame({
			values: {a: 1, b: 2},
			fail: (call) =>
				refuse && call.at !== undefined
					? Object.assign(new Error('no such block'), {
							code: BLOCK_NOT_RECORDED,
						})
					: undefined,
		});
		const errors: StateQueryError[] = [];
		const follower = createStateFollower(game.spec, execute, {
			onError: (e) => errors.push(e),
		});
		await follower.refreshAll();
		await follower.moved({
			kind: 'applied',
			block: 11,
			hash: '0x11',
			coherence: 'c1',
			entities: ['aRow'],
		});
		await follower.moved({
			kind: 'applied',
			block: 12,
			hash: '0xdead',
			coherence: 'c1',
			entities: ['bRow'],
		});
		refuse = false;
		expect(game.calls.slice(-2).map((c) => c.at)).toEqual([
			{number: 12, hash: '0xdead'},
			undefined,
		]);
		expect(errors).toEqual([]);
		expect(follower.state?.block).toBe(10);
	});

	it('any other failure is reported, carrying its code, and the next read is a full one', async () => {
		let fail = true;
		const game = toyGame({
			values: {a: 1, b: 2},
			fail: (call) =>
				fail && call.at !== undefined
					? new StateQueryError('too many rows', 'rows-examined-bound')
					: undefined,
		});
		const errors: StateQueryError[] = [];
		const follower = createStateFollower(game.spec, execute, {
			onError: (e) => errors.push(e),
		});
		await follower.refreshAll();
		await follower.moved({
			kind: 'applied',
			block: 11,
			hash: '0x11',
			coherence: 'c1',
			entities: [],
		});
		await follower.moved({
			kind: 'applied',
			block: 12,
			hash: '0x12',
			coherence: 'c1',
			entities: ['aRow'],
		});
		expect(errors.map((e) => e.code)).toEqual(['rows-examined-bound']);
		fail = false;
		await follower.moved({
			kind: 'applied',
			block: 13,
			hash: '0x13',
			coherence: 'c1',
			entities: ['bRow'],
		});
		expect(game.calls.at(-1)).toMatchObject({
			parts: ['a', 'b', 'mine'],
			at: undefined,
		});
	});

	it('serialises its reads: the moves that arrive during one are merged into the next, pinned to the latest block', async () => {
		let release: () => void = () => {};
		let held = false;
		const game = toyGame({
			values: {a: 1, b: 2},
			gate: () =>
				held
					? new Promise<void>((resolve) => (release = resolve))
					: Promise.resolve(),
		});
		const follower = createStateFollower(game.spec, execute);
		await follower.refreshAll();
		await follower.moved({
			kind: 'applied',
			block: 11,
			hash: '0x11',
			coherence: 'c1',
			entities: [],
		});
		held = true;
		const first = follower.moved({
			kind: 'applied',
			block: 12,
			hash: '0x12',
			coherence: 'c1',
			entities: ['aRow'],
		});
		void follower.moved({
			kind: 'applied',
			block: 14,
			hash: '0x14',
			coherence: 'c1',
			entities: ['bRow'],
		});
		void follower.moved({
			kind: 'applied',
			block: 13,
			hash: '0x13',
			coherence: 'c1',
			entities: ['aRow'],
		});
		held = false;
		release();
		await first;
		expect(game.calls.slice(2)).toMatchObject([
			{parts: ['a'], at: {number: 12, hash: '0x12'}},
			{parts: ['a', 'b'], at: {number: 14, hash: '0x14'}},
		]);
	});

	it('a partial read is pinned to the block the state is at when it is later than the signal', async () => {
		const game = toyGame({
			values: {a: 1, b: 2},
			tip: {number: 20, hash: '0x20'},
		});
		const follower = createStateFollower(game.spec, execute);
		await follower.refreshAll();
		await follower.moved({
			kind: 'applied',
			block: 11,
			hash: '0x11',
			coherence: 'c1',
			entities: [],
		});
		await follower.moved({
			kind: 'applied',
			block: 15,
			hash: '0x15',
			coherence: 'c1',
			entities: ['aRow'],
		});
		expect(game.calls.at(-1)?.at).toEqual({number: 20, hash: '0x20'});
	});

	it('who plays changing re-reads the part that depends on it, and only that', async () => {
		const game = toyGame({values: {a: 1, b: 2}});
		const follower = createStateFollower(game.spec, execute, {account: 'Me'});
		await follower.refreshAll();
		await follower.setAccount('me');
		expect(game.calls).toHaveLength(1);
		await follower.setAccount('you');
		expect(game.calls.at(-1)).toMatchObject({
			parts: ['mine'],
			account: 'you',
			at: {number: 10, hash: '0x10'},
		});
		expect(follower.state?.data.mine).toBe('of you');
	});

	it('a game with no account part ignores who plays', async () => {
		const game = toyGame({values: {a: 1, b: 2}});
		const follower = createStateFollower(
			{...game.spec, accountPart: undefined},
			execute,
		);
		await follower.refreshAll();
		await follower.setAccount('you');
		expect(game.calls).toHaveLength(1);
	});

	it('names the parts an entity moves, and every part for one it does not know', () => {
		const {spec} = toyGame({values: {a: 1, b: 2}});
		expect([...partsMovedBy(spec, ['aRow', 'aRow'])]).toEqual(['a']);
		expect([...partsMovedBy(spec, ['aRow', 'bRow'])].sort()).toEqual([
			'a',
			'b',
		]);
		expect([...partsMovedBy(spec, ['aRow', 'other'])].sort()).toEqual([
			'a',
			'b',
			'mine',
		]);
	});
});
