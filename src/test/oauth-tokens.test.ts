import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { validateCodeChallenge } from '../lib/oauth/pkce.js';
import {
	cleanupExpiredTokens,
	exchangeAuthCode,
	generateToken,
	getTokenStats,
	getTokenStoragePath,
	refreshAccessToken,
	revokeClientTokens,
	revokeToken,
	storeAuthCode,
	storeCsrfToken,
	validateAccessToken,
	validateCsrfToken,
} from '../lib/oauth/tokens.js';

describe('OAuth Tokens', () => {
	beforeEach(() => {
		// Set test storage path
		process.env.XDG_CONFIG_HOME = '/tmp/mdq-test-oauth';
	});

	afterEach(() => {
		// Clean up test storage
		try {
			const storagePath = getTokenStoragePath();
			if (fs.existsSync(storagePath)) {
				fs.unlinkSync(storagePath);
			}
			const storageDir = storagePath.substring(0, storagePath.lastIndexOf('/'));
			if (fs.existsSync(storageDir)) {
				fs.rmSync(storageDir, { recursive: true });
			}
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	describe('generateToken', () => {
		test('generates tokens of correct length', () => {
			const token = generateToken(32);
			// Base64URL encoding: 32 bytes = 43 chars (without padding)
			expect(token.length).toBeGreaterThanOrEqual(43);
		});

		test('generates unique tokens', () => {
			const token1 = generateToken(32);
			const token2 = generateToken(32);
			expect(token1).not.toBe(token2);
		});

		test('generates URL-safe tokens', () => {
			const token = generateToken(32);
			// Should only contain [A-Za-z0-9-_]
			expect(/^[A-Za-z0-9\-_]+$/.test(token)).toBe(true);
		});
	});

	describe('Authorization Codes', () => {
		test('stores and retrieves authorization code', () => {
			const code = generateToken(32);
			const verifier = generateToken(32);
			const challenge = 'test-challenge';

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: challenge,
				code_challenge_method: 'S256',
			});

			// Mock PKCE validation for test
			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, verifier, mockValidate);

			expect(tokens).toBeDefined();
			expect(tokens?.accessToken.client_id).toBe('test-client');
			expect(tokens?.refreshToken.client_id).toBe('test-client');
		});

		test('authorization code is single-use', () => {
			const code = generateToken(32);
			const verifier = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const token1 = exchangeAuthCode(code, verifier, mockValidate);
			expect(token1).toBeDefined();

			// Second attempt should fail
			const token2 = exchangeAuthCode(code, verifier, mockValidate);
			expect(token2).toBeUndefined();
		});

		test('rejects expired authorization code', () => {
			const code = generateToken(32);

			// Store code with short expiry by modifying storage directly
			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			// Manually set expiry to past
			const storagePath = getTokenStoragePath();
			const storage = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
			storage.authorization_codes[code].expires_at = Date.now() - 1000;
			fs.writeFileSync(storagePath, JSON.stringify(storage));

			const mockValidate = () => true;
			const tokenData = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokenData).toBeUndefined();
		});

		test('validates PKCE challenge', () => {
			const code = generateToken(32);
			const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
			const wrongVerifier = 'wrongverifierdBjftJeZ4CVP-mB92K27uhbUJU1p1r_';

			// Compute correct challenge
			const crypto = require('node:crypto');
			const hash = crypto.createHash('sha256').update(verifier).digest();
			const challenge = hash
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=/g, '');

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: challenge,
				code_challenge_method: 'S256',
			});

			// Correct verifier should work
			const tokenData1 = exchangeAuthCode(code, verifier, validateCodeChallenge);
			expect(tokenData1).toBeDefined();

			// Store again for second test
			const code2 = generateToken(32);
			storeAuthCode(code2, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: challenge,
				code_challenge_method: 'S256',
			});

			// Wrong verifier should fail
			const tokenData2 = exchangeAuthCode(code2, wrongVerifier, validateCodeChallenge);
			expect(tokenData2).toBeUndefined();
		});
	});

	describe('Access Tokens', () => {
		test('validates valid access token', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				const validated = validateAccessToken(tokens.accessToken.token);
				expect(validated).toBeDefined();
				expect(validated?.client_id).toBe('test-client');
			}
		});

		test('rejects invalid access token', () => {
			const fakeToken = 'fake-token-that-does-not-exist';
			const validated = validateAccessToken(fakeToken);
			expect(validated).toBeUndefined();
		});

		test('rejects expired access token', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Manually expire the token
				const storagePath = getTokenStoragePath();
				const storage = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
				storage.access_tokens[tokens.accessToken.token].expires_at = Date.now() - 1000;
				fs.writeFileSync(storagePath, JSON.stringify(storage));

				const validated = validateAccessToken(tokens.accessToken.token);
				expect(validated).toBeUndefined();
			}
		});
	});

	describe('CSRF Tokens', () => {
		test('stores and validates CSRF token', () => {
			const token = generateToken(32);
			storeCsrfToken(token);

			const isValid = validateCsrfToken(token);
			expect(isValid).toBe(true);
		});

		test('CSRF token is single-use', () => {
			const token = generateToken(32);
			storeCsrfToken(token);

			const isValid1 = validateCsrfToken(token);
			expect(isValid1).toBe(true);

			// Second validation should fail (token consumed)
			const isValid2 = validateCsrfToken(token);
			expect(isValid2).toBe(false);
		});

		test('rejects invalid CSRF token', () => {
			const isValid = validateCsrfToken('invalid-token');
			expect(isValid).toBe(false);
		});
	});

	describe('Token Cleanup', () => {
		test('cleans up expired tokens', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			// Manually expire tokens
			const storagePath = getTokenStoragePath();
			const storage = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
			storage.authorization_codes[code].expires_at = Date.now() - 1000;
			fs.writeFileSync(storagePath, JSON.stringify(storage));

			const result = cleanupExpiredTokens();
			expect(result.codes).toBe(1);
		});
	});

	describe('Client Token Revocation', () => {
		test('revokes all tokens for a client', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			const revokedCount = revokeClientTokens('test-client');
			expect(revokedCount).toBeGreaterThan(0);

			// Verify token is revoked
			if (tokens) {
				const validated = validateAccessToken(tokens.accessToken.token);
				expect(validated).toBeUndefined();
			}
		});
	});

	describe('Token Statistics', () => {
		test('returns correct token stats', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const stats = getTokenStats();
			expect(stats.authCodes.total).toBe(1);
			expect(stats.authCodes.expired).toBe(0);
		});
	});

	describe('Refresh Tokens', () => {
		test('exchanges authorization code returns both access and refresh tokens', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);

			expect(tokens).toBeDefined();
			expect(tokens?.accessToken).toBeDefined();
			expect(tokens?.refreshToken).toBeDefined();
			expect(tokens?.accessToken.client_id).toBe('test-client');
			expect(tokens?.refreshToken.client_id).toBe('test-client');
		});

		test('refreshes access token with valid refresh token', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Use refresh token to get new access token
				const newAccessToken = refreshAccessToken(tokens.refreshToken.token, 'test-client');
				expect(newAccessToken).toBeDefined();
				expect(newAccessToken?.client_id).toBe('test-client');
				expect(newAccessToken?.token).not.toBe(tokens.accessToken.token);
			}
		});

		test('rejects invalid refresh token', () => {
			const fakeToken = 'fake-refresh-token';
			const newAccessToken = refreshAccessToken(fakeToken, 'test-client');
			expect(newAccessToken).toBeUndefined();
		});

		test('rejects expired refresh token', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Manually expire the refresh token
				const storagePath = getTokenStoragePath();
				const storage = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
				storage.refresh_tokens[tokens.refreshToken.token].expires_at = Date.now() - 1000;
				fs.writeFileSync(storagePath, JSON.stringify(storage));

				const newAccessToken = refreshAccessToken(tokens.refreshToken.token, 'test-client');
				expect(newAccessToken).toBeUndefined();
			}
		});

		test('rejects refresh token from different client', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Try to use refresh token with wrong client_id
				const newAccessToken = refreshAccessToken(tokens.refreshToken.token, 'wrong-client');
				expect(newAccessToken).toBeUndefined();
			}
		});
	});

	describe('Token Revocation', () => {
		test('revokes access token', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Revoke access token
				const revoked = revokeToken(tokens.accessToken.token, 'test-client', 'access_token');
				expect(revoked).toBe(true);

				// Verify token is revoked
				const validated = validateAccessToken(tokens.accessToken.token);
				expect(validated).toBeUndefined();
			}
		});

		test('revokes refresh token', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Revoke refresh token
				const revoked = revokeToken(tokens.refreshToken.token, 'test-client', 'refresh_token');
				expect(revoked).toBe(true);

				// Verify refresh token is revoked
				const newAccessToken = refreshAccessToken(tokens.refreshToken.token, 'test-client');
				expect(newAccessToken).toBeUndefined();
			}
		});

		test('returns false when revoking non-existent token', () => {
			const revoked = revokeToken('non-existent-token', 'test-client');
			expect(revoked).toBe(false);
		});

		test('revokes tokens without hint', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Revoke without type hint
				const revoked = revokeToken(tokens.accessToken.token, 'test-client');
				expect(revoked).toBe(true);

				// Verify token is revoked
				const validated = validateAccessToken(tokens.accessToken.token);
				expect(validated).toBeUndefined();
			}
		});

		test('rejects revoke from different client', () => {
			const code = generateToken(32);

			storeAuthCode(code, {
				client_id: 'test-client',
				redirect_uri: 'http://localhost:8080/callback',
				code_challenge: 'test-challenge',
				code_challenge_method: 'S256',
			});

			const mockValidate = () => true;
			const tokens = exchangeAuthCode(code, generateToken(32), mockValidate);
			expect(tokens).toBeDefined();

			if (tokens) {
				// Try to revoke with wrong client_id
				const revoked = revokeToken(tokens.accessToken.token, 'wrong-client', 'access_token');
				expect(revoked).toBe(false);

				// Verify token is still valid
				const validated = validateAccessToken(tokens.accessToken.token);
				expect(validated).toBeDefined();
			}
		});
	});
});
