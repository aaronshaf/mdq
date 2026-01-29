import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Validate a PKCE code verifier format.
 * Must be 43-128 characters, using [A-Z], [a-z], [0-9], "-", ".", "_", "~"
 * See RFC 7636 Section 4.1
 */
export function isValidCodeVerifier(verifier: string): boolean {
	if (verifier.length < 43 || verifier.length > 128) {
		return false;
	}

	// Check character set: [A-Za-z0-9-._~]
	const validPattern = /^[A-Za-z0-9\-._~]+$/;
	return validPattern.test(verifier);
}

/**
 * Validate a PKCE code challenge against a code verifier.
 * Supports S256 method (SHA256 hash).
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param verifier - The code verifier from the client
 * @param challenge - The code challenge stored during authorization
 * @param method - The code challenge method (must be 'S256')
 * @returns true if valid, false otherwise
 */
export function validateCodeChallenge(
	verifier: string,
	challenge: string,
	method: string,
): boolean {
	// Only support S256 method
	if (method !== 'S256') {
		return false;
	}

	// Validate verifier format
	if (!isValidCodeVerifier(verifier)) {
		return false;
	}

	// Compute SHA256 hash of verifier and base64url encode
	const hash = createHash('sha256').update(verifier).digest();
	const computed = hash
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');

	// Use constant-time comparison
	try {
		const computedBuffer = Buffer.from(computed);
		const challengeBuffer = Buffer.from(challenge);

		// Different lengths indicate different values
		if (computedBuffer.length !== challengeBuffer.length) {
			return false;
		}

		return timingSafeEqual(computedBuffer, challengeBuffer);
	} catch {
		// timingSafeEqual throws if buffers have different lengths
		// This shouldn't happen due to the check above, but handle it
		return false;
	}
}
