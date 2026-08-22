import {describe, it, expect} from 'vitest';
import {parseImpersonateAddresses} from '../../src/lib/dev-accounts';

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const SECOND = '0xF78cD306b23031dE9E739A5BcDE61764e82AD5eF';

describe('parseImpersonateAddresses', () => {
	it('reads a comma-separated list', () => {
		expect(parseImpersonateAddresses(`${VITALIK},${SECOND}`)).toEqual([
			VITALIK,
			SECOND,
		]);
	});

	it('tolerates spacing and a trailing comma', () => {
		expect(parseImpersonateAddresses(` ${VITALIK} , ${SECOND} , `)).toEqual([
			VITALIK,
			SECOND,
		]);
	});

	it('is empty when unset or blank, rather than inventing addresses', () => {
		// Which accounts exist belongs to the environment: an app with no burner
		// wallet configured should offer nobody, not a built-in stranger.
		expect(parseImpersonateAddresses(undefined)).toEqual([]);
		expect(parseImpersonateAddresses('')).toEqual([]);
		expect(parseImpersonateAddresses('  ,  ')).toEqual([]);
	});

	it('drops entries that are not addresses, rather than casting them', () => {
		// The return type promises `0x${string}`; anything else would be a lie the
		// burner wallet discovers later, in a place that cannot explain it. A `0x`
		// prefix is not enough to make that promise true.
		expect(
			parseImpersonateAddresses(
				`${VITALIK},not-an-address,0x,0xzz,${VITALIK.slice(0, -1)}`,
			),
		).toEqual([VITALIK]);
	});

	it('reports what it dropped, so a typo is not silently one account short', () => {
		const dropped: string[] = [];
		parseImpersonateAddresses(`${VITALIK},0xzz`, {
			onDropped: (entry) => dropped.push(entry),
		});
		expect(dropped).toEqual(['0xzz']);
	});

	it('preserves order, since callers select by index', () => {
		// e2e files pick their account with `walletAccountIndex`, so the order of
		// the configured list is part of its meaning.
		expect(parseImpersonateAddresses(`${SECOND},${VITALIK}`)).toEqual([
			SECOND,
			VITALIK,
		]);
	});
});
