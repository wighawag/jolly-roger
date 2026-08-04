/**
 * A random opaque id, usable in insecure contexts.
 *
 * `crypto.randomUUID()` is gated on a *secure context*, so it exists on
 * https and on localhost but NOT when the dev server is reached over a plain
 * http LAN address, which is exactly how a phone on the same network reaches
 * it. Calling it there throws, so anything that needs an id at startup would
 * take the whole app down on mobile.
 *
 * `crypto.getRandomValues()` carries no such gate (only `randomUUID` and
 * `crypto.subtle` do), so it is the portable source of randomness. The final
 * fallback exists only so this can never be the thing that throws; it is not
 * meant to be cryptographically strong, and no caller should rely on it for
 * that.
 */
export function randomId(): string {
	const webCrypto = globalThis.crypto as Crypto | undefined;

	if (typeof webCrypto?.randomUUID === 'function') {
		return webCrypto.randomUUID();
	}

	if (typeof webCrypto?.getRandomValues === 'function') {
		const bytes = webCrypto.getRandomValues(new Uint8Array(16));
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
			'',
		);
	}

	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
