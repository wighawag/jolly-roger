import {describe, it, expect} from 'vitest';
import {parseImpersonateAddresses} from '$lib/dev-accounts';

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const OTHER = '0xF78cD306b23031dE9E739A5BcDE61764e82AD5eF';

describe('parseImpersonateAddresses', () => {
	it('parses a comma-separated list', () => {
		expect(parseImpersonateAddresses(`${VITALIK},${OTHER}`)).toEqual([
			VITALIK,
			OTHER,
		]);
	});

	it('tolerates whitespace around entries', () => {
		expect(parseImpersonateAddresses(`  ${VITALIK} ,  ${OTHER}  `)).toEqual([
			VITALIK,
			OTHER,
		]);
	});

	it.each([undefined, '', '   ', ','])(
		'yields nothing for %p, which means impersonation is off',
		(raw) => {
			expect(parseImpersonateAddresses(raw)).toEqual([]);
		},
	);

	it('drops malformed entries instead of throwing', () => {
		// Dev-only convenience config. A stray comma or a half-pasted address must
		// not take down context construction, which also has to survive
		// prerendering, where there is nobody to show an error to.
		expect(parseImpersonateAddresses(`${VITALIK},nonsense,0x1234,`)).toEqual([
			VITALIK,
		]);
	});

	it('preserves the given casing, so checksums survive', () => {
		expect(parseImpersonateAddresses(VITALIK)[0]).toBe(VITALIK);
	});
});
