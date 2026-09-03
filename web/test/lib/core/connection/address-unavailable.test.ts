import {describe, it, expect} from 'vitest';
import {addressUnavailableView} from '../../../../src/lib/core/connection/address-unavailable';

const WANTED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const ON = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;

describe('addressUnavailableView', () => {
	it('says nothing when the connection is not resting on it', () => {
		expect(addressUnavailableView(undefined)).toBeUndefined();
	});

	it('names the account to switch to, and the one the wallet is on', () => {
		const view = addressUnavailableView({
			requested: WANTED,
			walletName: 'Rabby',
			selected: ON,
			available: [ON],
			message: 'library sentence',
		});

		expect(view?.title).toBe('Switch account');
		expect(view?.message).toContain('0xaaaa');
		expect(view?.message).toContain('Rabby');
		expect(view?.detail).toContain('0xbbbb');
	});

	it('promises it will carry on by itself, because it does', () => {
		// The library resumes the pending request when the wallet moves to the
		// requested account, so telling the user to switch AND press something
		// would be describing a step that does not exist.
		const view = addressUnavailableView({
			requested: WANTED,
			walletName: 'Rabby',
			selected: ON,
			available: [ON],
			message: 'library sentence',
		});
		expect(view?.message).toMatch(/carry on by itself/i);
	});

	it('asks a wallet offering NO account to unlock, not to switch', () => {
		// A wallet offering nothing is a locked one. `selected` goes absent as the
		// wallet moves, so this is a live state rather than a starting one, and
		// telling someone to switch account in a wallet they cannot see into is
		// an instruction they cannot follow.
		const view = addressUnavailableView({
			requested: WANTED,
			walletName: 'Rabby',
			available: [],
			message: 'library sentence',
		});

		expect(view?.title).toBe('Unlock your wallet');
		expect(view?.message).toMatch(/unlock/i);
		expect(view?.detail).toBeUndefined();
	});

	it('copes with a wallet it has no name for', () => {
		const view = addressUnavailableView({
			requested: WANTED,
			selected: ON,
			available: [ON],
			message: 'library sentence',
		});
		expect(view?.message).toContain('your wallet');
		expect(view?.message).not.toContain('undefined');
	});

	it('never offers `available` as a list to choose from', () => {
		// It is what the wallet is EXPOSING, not what the user owns: Rabby reports
		// only the account it is on, so it routinely omits an address the user is
		// holding. Rendering it would tell that user their account does not exist,
		// and picking from it would abandon the request as a cancellation.
		const many = [
			ON,
			'0xcccccccccccccccccccccccccccccccccccccccc',
			'0xdddddddddddddddddddddddddddddddddddddddd',
		] as `0x${string}`[];
		const view = addressUnavailableView({
			requested: WANTED,
			walletName: 'MetaMask',
			selected: ON,
			available: many,
			message: 'library sentence',
		});

		const text = `${view?.message} ${view?.detail ?? ''}`;
		expect(text).not.toContain('0xcccc');
		expect(text).not.toContain('0xdddd');
	});
});
