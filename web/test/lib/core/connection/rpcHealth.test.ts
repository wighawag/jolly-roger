import {describe, it, expect} from 'vitest';
import {computeHealth, settle} from '../../../../src/lib/core/connection/rpcHealth';
import type {PollingStatus} from '../../../../src/lib/core/connection/polling-store';

describe('settle', () => {
	it('is pending while loading (ignores the transient error-cleared blip)', () => {
		expect(settle({loading: true, lastSuccessfulFetch: 1000}).state).toBe('pending');
		// loading after a prior error is still pending, not ok
		expect(settle({loading: true, error: undefined}).state).toBe('pending');
	});

	it('is ok when settled with a prior successful fetch', () => {
		expect(settle({loading: false, lastSuccessfulFetch: 1000}).state).toBe('ok');
	});

	it('is error when settled with an error', () => {
		const s = settle({loading: false, error: {message: 'boom'}, lastSuccessfulFetch: 1000});
		expect(s).toEqual({state: 'error', error: {message: 'boom'}});
	});

	it('is pending when idle and never fetched (never-run / gated input)', () => {
		expect(settle({loading: false}).state).toBe('pending');
	});
});

describe('computeHealth (most-recent settle wins)', () => {
	it('is healthy when the most recent settle is ok', () => {
		const r = computeHealth([
			{outcome: {state: 'error', error: {message: 'old'}}, at: 100},
			{outcome: {state: 'ok'}, at: 200},
		]);
		expect(r.healthy).toBe(true);
	});

	it('is unhealthy when the most recent settle is an error', () => {
		const r = computeHealth([
			{outcome: {state: 'ok'}, at: 100},
			{outcome: {state: 'error', error: {message: 'boom'}}, at: 200},
		]);
		expect(r.healthy).toBe(false);
		expect(r.error?.message).toBe('boom');
	});

	it('ignores pending inputs and is healthy when nothing has settled', () => {
		expect(
			computeHealth([
				{outcome: {state: 'pending'}, at: 0},
				{outcome: {state: 'pending'}, at: 0},
			]).healthy,
		).toBe(true);
		expect(computeHealth([]).healthy).toBe(true);
	});
});

describe('health scenarios', () => {
	// A fresh error shows the banner even if a slow poller still holds an older
	// success (symptom 1: banner was not showing).
	it('a fresh error shows unhealthy despite an older success elsewhere', () => {
		const r = computeHealth([
			{outcome: {state: 'ok'}, at: 1000}, // stale gas success from 10 min ago
			{outcome: {state: 'error', error: {message: 'boom'}}, at: 5000}, // onchain just failed
		]);
		expect(r.healthy).toBe(false);
	});

	// A fresh success clears the banner even if a slow poller still holds an
	// older error (the original stuck-banner bug).
	it('a fresh success clears the banner despite an older error elsewhere', () => {
		const r = computeHealth([
			{outcome: {state: 'error', error: {message: 'stale gas error'}}, at: 1000},
			{outcome: {state: 'ok'}, at: 5000}, // onchain just succeeded (e.g. Retry)
		]);
		expect(r.healthy).toBe(true);
	});

	// The retry flicker: while loading, polling-store clears the error, but
	// settle() returns pending so the store keeps the prior error timestamp;
	// health must not flip healthy mid-retry when all inputs are down.
	it('stays unhealthy during an in-flight retry when all are down', () => {
		const loadingBlip: PollingStatus = {loading: true, error: undefined, lastSuccessfulFetch: 500};
		expect(settle(loadingBlip).state).toBe('pending');
		const timed = [
			{outcome: {state: 'error' as const, error: {message: 'boom'}}, at: 5000},
			{outcome: {state: 'error' as const, error: {message: 'boom'}}, at: 5000},
		];
		expect(computeHealth(timed).healthy).toBe(false);
	});
});
