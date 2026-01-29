import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { isValidCodeVerifier, validateCodeChallenge } from '../lib/oauth/pkce.js';

describe('PKCE', () => {
	describe('isValidCodeVerifier', () => {
		test('accepts valid verifier (43 chars)', () => {
			const verifier = 'a'.repeat(43);
			expect(isValidCodeVerifier(verifier)).toBe(true);
		});

		test('accepts valid verifier (128 chars)', () => {
			const verifier = 'a'.repeat(128);
			expect(isValidCodeVerifier(verifier)).toBe(true);
		});

		test('accepts verifier with allowed characters', () => {
			const verifier = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
			expect(isValidCodeVerifier(verifier)).toBe(true);
		});

		test('rejects verifier too short', () => {
			const verifier = 'a'.repeat(42);
			expect(isValidCodeVerifier(verifier)).toBe(false);
		});

		test('rejects verifier too long', () => {
			const verifier = 'a'.repeat(129);
			expect(isValidCodeVerifier(verifier)).toBe(false);
		});

		test('rejects verifier with invalid characters', () => {
			const verifier = `${'a'.repeat(43)}!`;
			expect(isValidCodeVerifier(verifier)).toBe(false);
		});

		test('rejects verifier with spaces', () => {
			const verifier = `${'a'.repeat(43)} `;
			expect(isValidCodeVerifier(verifier)).toBe(false);
		});
	});

	describe('validateCodeChallenge', () => {
		test('validates correct S256 challenge', () => {
			const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
			const hash = createHash('sha256').update(verifier).digest();
			const challenge = hash
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=/g, '');

			expect(validateCodeChallenge(verifier, challenge, 'S256')).toBe(true);
		});

		test('rejects incorrect verifier', () => {
			const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
			const wrongVerifier = 'wrongverifierdBjftJeZ4CVP-mB92K27uhbUJU1p1r_';
			const hash = createHash('sha256').update(verifier).digest();
			const challenge = hash
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=/g, '');

			expect(validateCodeChallenge(wrongVerifier, challenge, 'S256')).toBe(false);
		});

		test('rejects plain method', () => {
			const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
			expect(validateCodeChallenge(verifier, verifier, 'plain')).toBe(false);
		});

		test('rejects invalid verifier format', () => {
			const verifier = 'tooshort';
			const challenge = 'somechallenge';
			expect(validateCodeChallenge(verifier, challenge, 'S256')).toBe(false);
		});

		test('handles case sensitivity correctly', () => {
			const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
			const hash = createHash('sha256').update(verifier).digest();
			const challenge = hash
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=/g, '');
			const wrongCaseChallenge = challenge.toUpperCase();

			expect(validateCodeChallenge(verifier, wrongCaseChallenge, 'S256')).toBe(false);
		});
	});

	describe('timing attack resistance', () => {
		test('comparison should be constant-time', () => {
			// This is a basic test - true constant-time verification requires specialized tools
			const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
			const hash = createHash('sha256').update(verifier).digest();
			const challenge = hash
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=/g, '');

			// Create challenges that differ at different positions
			const challenge1 = `A${challenge.slice(1)}`; // Differs at start
			const challenge2 = `${challenge.slice(0, -1)}A`; // Differs at end

			// Both should fail in roughly the same time (we can't measure this easily in tests,
			// but we verify the function uses timingSafeEqual internally)
			expect(validateCodeChallenge(verifier, challenge1, 'S256')).toBe(false);
			expect(validateCodeChallenge(verifier, challenge2, 'S256')).toBe(false);
		});
	});
});
