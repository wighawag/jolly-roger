import {expect} from 'earl';
import {describe, it, before} from 'node:test';
import {network} from 'hardhat';
import {hashMessage, recoverMessageAddress, stringToBytes, toHex} from 'viem';
import {privateKeyToAccount, generatePrivateKey} from 'viem/accounts';

import {Abi_SignatureUtilsHarness} from '../../generated/abis/SignatureUtilsHarness.js';

const {viem} = await network.connect();

/**
 * The harness's ABI, GENERATED from the compiled contract.
 *
 * It is typed all the way down (the generator emits a literal tuple type, not
 * `Abi`), so abitype knows the function names, argument types and return types,
 * and `readContract` below is checked. Reading the artifact JSON and widening it
 * to `abi: any[]` would give none of that: a wrong function name or an extra
 * argument would compile and fail at runtime.
 *
 * The generator skips `*.t.sol`, which is why the harness sits in a file of its
 * own next to the tests that use it rather than inside them.
 */
const HARNESS_ABI = Abi_SignatureUtilsHarness;

/**
 * The seam between our EIP-191 implementation and everybody else's.
 *
 * `SignatureUtils` builds the `personal_sign` digest by hand, because verifying
 * a human-readable signed message onchain means reproducing exactly what the
 * wallet hashed. If our construction and a real signing library's disagree by
 * one byte, nothing errors: signatures simply stop verifying, everywhere, with
 * no clue as to why.
 *
 * The Solidity suite checks the construction against a hand-built digest, which
 * catches an error in our own arithmetic but cannot catch a wrong idea about
 * what EIP-191 IS. Only an independent implementation can do that, which is
 * what viem is here.
 */
describe('SignatureUtils', function () {
	let address: `0x${string}`;
	let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

	before(async function () {
		// By NAME: hardhat resolves the artifact, so nothing here encodes where
		// compiled output happens to live. Renaming the contract or moving the
		// file becomes a legible "artifact not found", not an ENOENT on a path.
		const deployed = await viem.deployContract('SignatureUtilsHarness');
		address = deployed.address;
		publicClient = await viem.getPublicClient();
	});

	function textDigest(message: string) {
		return publicClient.readContract({
			address,
			abi: HARNESS_ABI,
			functionName: 'textDigest',
			args: [toHex(stringToBytes(message))],
		});
	}

	function recover(digest: `0x${string}`, signature: `0x${string}`) {
		return publicClient.readContract({
			address,
			abi: HARNESS_ABI,
			functionName: 'recover',
			args: [digest, signature],
		});
	}

	describe('textDigest', function () {
		it("should equal viem's hashMessage for a plain string", async function () {
			const message = 'hello world';
			expect(await textDigest(message)).toEqual(hashMessage(message));
		});

		it('should agree across the length-prefix digit boundaries', async function () {
			// 9 -> 10 and 99 -> 100 are where the decimal length prefix gains a
			// digit, and where a home-grown implementation goes wrong.
			for (const length of [0, 1, 9, 10, 11, 99, 100, 101, 255, 1000]) {
				const message = 'x'.repeat(length);
				expect(await textDigest(message)).toEqual(hashMessage(message));
			}
		});

		it('should agree on multi-byte characters', async function () {
			// EIP-191 counts BYTES, not characters. A string measured in
			// characters would produce a different prefix here and verify nothing.
			const message = 'héllo wörld \u{1F3F4}\u{200D}\u{2620}\u{FE0F}';
			expect(stringToBytes(message).length).not.toEqual(message.length);
			expect(await textDigest(message)).toEqual(hashMessage(message));
		});

		it('should agree on the delegation message, which is the real payload', async function () {
			// The one message this repo actually signs. Long enough to have a
			// three-digit length prefix, so it exercises the case above for real.
			const message =
				'Origin: https://jolly-roger.example\n\n' +
				'IMPORTANT: Only sign on trusted websites.\n\n' +
				'This authorizes the following address to act on your behalf onchain:\n\n' +
				'0x00000000000000000000000000000000de1e6a7e\n\n' +
				'Apps at this origin can use it to send transactions in your name.';

			expect(stringToBytes(message).length).toBeGreaterThan(99);
			expect(await textDigest(message)).toEqual(hashMessage(message));
		});
	});

	describe('recover', function () {
		it('should recover the address viem signed with', async function () {
			const account = privateKeyToAccount(generatePrivateKey());
			const message = 'authorise me';
			const signature = await account.signMessage({message});

			expect(await recover(hashMessage(message), signature)).toEqual(
				account.address,
			);
		});

		it('should agree with viem about who signed, over many messages', async function () {
			for (const message of ['', 'a', 'x'.repeat(200), '\u{1F511} key']) {
				const account = privateKeyToAccount(generatePrivateKey());
				const signature = await account.signMessage({message});

				const [onchain, offchain] = await Promise.all([
					recover(await textDigest(message), signature),
					recoverMessageAddress({message, signature}),
				]);

				expect(onchain).toEqual(offchain);
			}
		});

		it('should reject a signature from a different key', async function () {
			const signer = privateKeyToAccount(generatePrivateKey());
			const other = privateKeyToAccount(generatePrivateKey());
			const message = 'authorise me';
			const signature = await signer.signMessage({message});

			expect(await recover(hashMessage(message), signature)).not.toEqual(
				other.address,
			);
		});

		it('should reject a signature over a different message', async function () {
			const account = privateKeyToAccount(generatePrivateKey());
			const signature = await account.signMessage({message: 'one thing'});

			expect(
				await recover(hashMessage('another thing'), signature),
			).not.toEqual(account.address);
		});
	});

	/**
	 * Signature malleability, from the side that matters to a JS caller.
	 *
	 * secp256k1 is symmetric: for any valid `(r, s, v)` there is a second
	 * `(r, n - s, v ^ 1)` recovering the same address. We accept only the low
	 * half, which is a rule with two ways to get wrong, and the tests below are
	 * one for each.
	 */
	describe('malleability', function () {
		const N = BigInt(
			'0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
		);

		function flip(signature: `0x${string}`): `0x${string}` {
			const r = signature.slice(2, 66);
			const s = BigInt(`0x${signature.slice(66, 130)}`);
			const v = parseInt(signature.slice(130, 132), 16);
			const flippedS = (N - s).toString(16).padStart(64, '0');
			const flippedV = (v === 27 ? 28 : 27).toString(16).padStart(2, '0');
			return `0x${r}${flippedS}${flippedV}`;
		}

		it('should reject the flipped half of the curve', async function () {
			const account = privateKeyToAccount(generatePrivateKey());
			const message = 'authorise me';
			const signature = await account.signMessage({message});

			// The flipped form is a REAL signature by the same key: viem recovers
			// the same address from it. Rejecting it is a deliberate policy, not a
			// side effect of it being malformed.
			const flipped = flip(signature);
			expect(
				await recoverMessageAddress({message, signature: flipped}),
			).toEqual(account.address);

			await expect(recover(hashMessage(message), flipped)).toBeRejected();
		});

		/**
		 * The inverse, and the one that would actually bite in production.
		 *
		 * Being too strict is the dangerous direction: if viem ever handed us a
		 * high-`s` signature, every affected user would be unable to register a
		 * delegate, with a revert that says nothing about why. RFC 6979 signing is
		 * canonical and always low-`s`, and this asserts that rather than trusting
		 * it, across enough keys to catch a one-in-a-few-hundred surprise.
		 */
		it('should never reject a signature viem actually produced', async function () {
			const halfN = N / 2n;

			for (let i = 0; i < 64; i++) {
				const account = privateKeyToAccount(generatePrivateKey());
				const message = `authorise me ${i}`;
				const signature = await account.signMessage({message});

				const s = BigInt(`0x${signature.slice(66, 130)}`);
				expect(s <= halfN).toEqual(true);

				expect(await recover(hashMessage(message), signature)).toEqual(
					account.address,
				);
			}
		});
	});
});
