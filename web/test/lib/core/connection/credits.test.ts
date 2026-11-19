import {describe, it, expect} from 'vitest';
import {
	DEFAULT_CREDITS_PER_TOP_UP,
	formatCredits,
	resolveCreditsConfig,
	toCredits,
	topUpAmount,
} from '$lib/core/connection/credits';

const GWEI = 1_000_000_000n;

describe('resolveCreditsConfig', () => {
	it('multiplies the expected worst gas price by the gas one credit buys', () => {
		const config = resolveCreditsConfig({
			expectedWorstGasPrice: '1000000000',
			creditsGasMultiplier: 100_000,
		});
		expect(config?.creditUnit).toBe(GWEI * 100_000n);
	});

	it('accepts a wei gas price as a string, which is how it survives JSON', () => {
		// 100 gwei exceeds nothing here, but a mainnet-scale value would exceed
		// Number.MAX_SAFE_INTEGER once multiplied out, which is why the property is
		// declared as a string in the first place.
		const config = resolveCreditsConfig({
			expectedWorstGasPrice: '123456789012345678901234567890',
			creditsGasMultiplier: 2,
		});
		expect(config?.creditUnit).toBe(123456789012345678901234567890n * 2n);
	});

	it.each([
		['neither property', {}],
		['only a gas price', {expectedWorstGasPrice: '1000000000'}],
		['only a multiplier', {creditsGasMultiplier: 100_000}],
		[
			'a zero gas price',
			{expectedWorstGasPrice: '0', creditsGasMultiplier: 100_000},
		],
		[
			'a zero multiplier',
			{expectedWorstGasPrice: '1000000000', creditsGasMultiplier: 0},
		],
		[
			'a negative multiplier',
			{expectedWorstGasPrice: '1000000000', creditsGasMultiplier: -5},
		],
		[
			'a non-numeric gas price',
			{expectedWorstGasPrice: 'lots', creditsGasMultiplier: 100_000},
		],
	])('falls back to native currency with %s', (_label, properties) => {
		// Undefined is the signal the UI reads as "show ETH". A half-configured
		// chain must NOT get a defaulted credit unit: that would print a confident
		// move count derived from a number nobody set.
		expect(resolveCreditsConfig(properties)).toBe(undefined);
	});

	it('handles a chain with no properties at all', () => {
		expect(resolveCreditsConfig(undefined)).toBe(undefined);
	});

	it('defaults how many credits a top-up buys, and lets the chain override it', () => {
		const base = {
			expectedWorstGasPrice: '1000000000',
			creditsGasMultiplier: 100_000,
		};
		expect(resolveCreditsConfig(base)?.creditsPerTopUp).toBe(
			DEFAULT_CREDITS_PER_TOP_UP,
		);
		expect(
			resolveCreditsConfig({...base, creditsPerTopUp: 25})?.creditsPerTopUp,
		).toBe(25);
	});
});

describe('toCredits', () => {
	const unit = GWEI * 100_000n; // 0.0001 ETH per credit

	it('counts whole credits', () => {
		expect(toCredits(unit * 12n, unit)).toBe(12);
	});

	it('reports zero for an empty signer', () => {
		expect(toCredits(0n, unit)).toBe(0);
	});

	it('rounds DOWN, so an almost-affordable action never reads as affordable', () => {
		// One wei short of a credit reads as a fraction of one, never as one.
		expect(toCredits(unit - 1n, unit)).toBe(0.99);
		// 1.999... credits is 1.99, never 2.
		expect(toCredits(unit * 2n - 1n, unit)).toBe(1.99);
	});

	it('keeps two decimals of a partial credit', () => {
		expect(toCredits(unit / 2n, unit)).toBe(0.5);
		expect(toCredits(unit / 4n, unit)).toBe(0.25);
	});

	it('stays exact for a wei balance beyond double precision', () => {
		// 1e20 wei is far past Number.MAX_SAFE_INTEGER (~9e15), so converting the
		// BALANCE to a Number first would already have lost digits. Dividing in
		// bigint and converting only the small credit count keeps this exact.
		const balance = unit * 1_000_000n;
		expect(balance).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
		expect(toCredits(balance, unit)).toBe(1_000_000);
	});

	it('never divides by a zero unit', () => {
		expect(toCredits(1000n, 0n)).toBe(0);
	});
});

describe('formatCredits', () => {
	it('drops trailing zeros from a whole count', () => {
		expect(formatCredits(100)).toBe('100');
	});

	it('keeps a partial count readable', () => {
		expect(formatCredits(1.5)).toBe('1.5');
		expect(formatCredits(0.25)).toBe('0.25');
	});

	it('absorbs binary-float noise from the division', () => {
		expect(formatCredits(12.340000000000001)).toBe('12.34');
	});
});

describe('topUpAmount', () => {
	it('prices one top-up at its credits worth of wei', () => {
		const unit = GWEI * 100_000n;
		expect(topUpAmount({creditUnit: unit, creditsPerTopUp: 100})).toBe(
			unit * 100n,
		);
	});
});
