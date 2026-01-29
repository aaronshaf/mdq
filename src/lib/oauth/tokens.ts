import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
	AccessToken,
	AuthorizationCode,
	CsrfToken,
	RefreshToken,
	TokenStorage,
} from './types.js';
import { TokenStorageSchema } from './types.js';

// Authorization codes expire after 5 minutes
const AUTH_CODE_EXPIRY_MS = 5 * 60 * 1000;

// Access tokens expire after 1 hour (configurable via env var)
const ACCESS_TOKEN_EXPIRY_MS =
	Number.parseInt(process.env.MDQ_OAUTH_TOKEN_EXPIRY ?? '3600', 10) * 1000;

// CSRF tokens expire after 10 minutes
const CSRF_TOKEN_EXPIRY_MS = 10 * 60 * 1000;

// Refresh tokens expire after 30 days (configurable via env var)
const REFRESH_TOKEN_EXPIRY_MS =
	Number.parseInt(process.env.MDQ_OAUTH_REFRESH_TOKEN_EXPIRY ?? '2592000', 10) * 1000;

/**
 * Get the path to the OAuth tokens file.
 * Respects XDG_CONFIG_HOME, defaults to ~/.config/mdq/oauth-tokens.json
 */
export function getTokenStoragePath(): string {
	const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
	return path.join(configHome, 'mdq', 'oauth-tokens.json');
}

/**
 * Load the token storage, returning empty storage if it doesn't exist.
 */
function loadTokenStorage(): TokenStorage {
	const storagePath = getTokenStoragePath();

	// Check if file exists first
	if (!fs.existsSync(storagePath)) {
		return { authorization_codes: {}, access_tokens: {}, csrf_tokens: {}, refresh_tokens: {} };
	}

	try {
		const content = fs.readFileSync(storagePath, 'utf-8');
		const parsed = JSON.parse(content);

		// Validate with Zod
		const validated = TokenStorageSchema.parse(parsed);
		return validated;
	} catch (error) {
		// File exists but is invalid - warn and return empty storage
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Warning: Failed to parse OAuth tokens file: ${storagePath}`);
		console.error(`  ${message}`);
		console.error('Starting with empty token storage.');
		return { authorization_codes: {}, access_tokens: {}, csrf_tokens: {}, refresh_tokens: {} };
	}
}

/**
 * Save the token storage, creating the directory if needed.
 * Sets file permissions to 0600 (owner read/write only).
 */
function saveTokenStorage(storage: TokenStorage): void {
	const storagePath = getTokenStoragePath();
	const storageDir = path.dirname(storagePath);

	// Ensure directory exists
	fs.mkdirSync(storageDir, { recursive: true });

	// Write with pretty-print
	fs.writeFileSync(storagePath, `${JSON.stringify(storage, null, 2)}\n`, 'utf-8');

	// Set permissions to 0600 (owner read/write only)
	fs.chmodSync(storagePath, 0o600);
}

/**
 * Generate a cryptographically random token.
 * @param bytes - Number of random bytes (default: 32)
 * @returns Base64URL-encoded token
 */
export function generateToken(bytes = 32): string {
	return randomBytes(bytes)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
}

/**
 * Store an authorization code with PKCE challenge.
 * Authorization codes expire after 5 minutes.
 */
export function storeAuthCode(
	code: string,
	data: Omit<AuthorizationCode, 'code' | 'expires_at'>,
): void {
	const storage = loadTokenStorage();

	const authCode: AuthorizationCode = {
		code,
		...data,
		expires_at: Date.now() + AUTH_CODE_EXPIRY_MS,
	};

	storage.authorization_codes[code] = authCode;
	saveTokenStorage(storage);
}

/**
 * Exchange an authorization code for an access token and refresh token.
 * Validates the code verifier against the stored PKCE challenge.
 * The authorization code is single-use and deleted after exchange.
 *
 * @returns Token data (access token + refresh token) if successful, undefined if invalid/expired
 */
export function exchangeAuthCode(
	code: string,
	verifier: string,
	validateChallenge: (verifier: string, challenge: string, method: string) => boolean,
): { accessToken: AccessToken; refreshToken: RefreshToken } | undefined {
	const storage = loadTokenStorage();

	// Get the authorization code
	const authCode = storage.authorization_codes[code];
	if (!authCode) {
		return undefined;
	}

	// Check expiry
	if (Date.now() > authCode.expires_at) {
		// Clean up expired code
		delete storage.authorization_codes[code];
		saveTokenStorage(storage);
		return undefined;
	}

	// Validate PKCE challenge
	if (!validateChallenge(verifier, authCode.code_challenge, authCode.code_challenge_method)) {
		return undefined;
	}

	// Delete the authorization code (single-use)
	delete storage.authorization_codes[code];

	// Generate access token and refresh token
	const accessToken = generateToken(32);
	const refreshTokenStr = generateToken(32);
	const now = Date.now();

	const accessTokenData: AccessToken = {
		token: accessToken,
		client_id: authCode.client_id,
		scope: authCode.scope ?? '',
		issued_at: now,
		expires_at: now + ACCESS_TOKEN_EXPIRY_MS,
	};

	const refreshTokenData: RefreshToken = {
		token: refreshTokenStr,
		client_id: authCode.client_id,
		scope: authCode.scope ?? '',
		issued_at: now,
		expires_at: now + REFRESH_TOKEN_EXPIRY_MS,
	};

	storage.access_tokens[accessToken] = accessTokenData;
	storage.refresh_tokens[refreshTokenStr] = refreshTokenData;
	saveTokenStorage(storage);

	return { accessToken: accessTokenData, refreshToken: refreshTokenData };
}

/**
 * Validate an access token.
 * Returns the token data if valid, undefined if invalid/expired.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateAccessToken(token: string): AccessToken | undefined {
	const storage = loadTokenStorage();

	// Find token using constant-time comparison
	let foundToken: AccessToken | undefined;
	const tokenBuffer = Buffer.from(token);

	for (const [storedTokenStr, storedToken] of Object.entries(storage.access_tokens)) {
		const storedBuffer = Buffer.from(storedTokenStr);

		// Skip if lengths differ
		if (tokenBuffer.length !== storedBuffer.length) {
			continue;
		}

		// Use constant-time comparison
		try {
			if (timingSafeEqual(tokenBuffer, storedBuffer)) {
				foundToken = storedToken;
				break;
			}
		} catch {}
	}

	if (!foundToken) {
		return undefined;
	}

	// Check expiry
	if (Date.now() > foundToken.expires_at) {
		// Clean up expired token
		delete storage.access_tokens[token];
		saveTokenStorage(storage);
		return undefined;
	}

	return foundToken;
}

/**
 * Exchange a refresh token for a new access token.
 * Validates the refresh token and returns a new access token.
 * The refresh token can be reused until it expires.
 *
 * @param refreshToken - The refresh token to exchange
 * @param clientId - The client ID requesting the refresh
 * @param requestedScope - Optional scope (must match original scope)
 * @returns New access token if successful, undefined if invalid/expired
 */
export function refreshAccessToken(
	refreshToken: string,
	clientId: string,
	requestedScope?: string,
): AccessToken | undefined {
	const storage = loadTokenStorage();

	// Find refresh token using constant-time comparison
	let foundRefreshToken: RefreshToken | undefined;
	let foundTokenKey: string | undefined;
	const tokenBuffer = Buffer.from(refreshToken);

	for (const [storedTokenStr, storedToken] of Object.entries(storage.refresh_tokens)) {
		const storedBuffer = Buffer.from(storedTokenStr);

		// Skip if lengths differ
		if (tokenBuffer.length !== storedBuffer.length) {
			continue;
		}

		// Use constant-time comparison
		try {
			if (timingSafeEqual(tokenBuffer, storedBuffer)) {
				foundRefreshToken = storedToken;
				foundTokenKey = storedTokenStr;
				break;
			}
		} catch {}
	}

	if (!foundRefreshToken || !foundTokenKey) {
		return undefined;
	}

	// Validate client ownership
	if (foundRefreshToken.client_id !== clientId) {
		return undefined;
	}

	// Check expiry
	if (Date.now() > foundRefreshToken.expires_at) {
		// Clean up expired token using the matched key
		delete storage.refresh_tokens[foundTokenKey];
		saveTokenStorage(storage);
		return undefined;
	}

	// Validate scope (if requested, must be exact match of original scope)
	const scope = requestedScope ?? foundRefreshToken.scope;
	if (requestedScope && requestedScope !== foundRefreshToken.scope) {
		// Require exact match - subset validation not implemented
		return undefined;
	}

	// Generate new access token
	const accessToken = generateToken(32);
	const now = Date.now();

	const accessTokenData: AccessToken = {
		token: accessToken,
		client_id: foundRefreshToken.client_id,
		scope,
		issued_at: now,
		expires_at: now + ACCESS_TOKEN_EXPIRY_MS,
	};

	storage.access_tokens[accessToken] = accessTokenData;
	saveTokenStorage(storage);

	return accessTokenData;
}

/**
 * Revoke a specific token (access token or refresh token).
 * Uses constant-time comparison to prevent timing attacks.
 * Validates that the token belongs to the requesting client.
 *
 * @param token - The token to revoke
 * @param clientId - The client ID requesting the revocation
 * @param tokenTypeHint - Optional hint about token type
 * @returns true if a token was revoked, false if not found or doesn't belong to client
 */
export function revokeToken(
	token: string,
	clientId: string,
	tokenTypeHint?: 'access_token' | 'refresh_token',
): boolean {
	const storage = loadTokenStorage();
	const tokenBuffer = Buffer.from(token);
	let revoked = false;
	let tokenKey: string | undefined;

	// Helper function for constant-time token search
	const findToken = (tokens: Record<string, { client_id: string }>): string | undefined => {
		for (const [storedTokenStr, storedToken] of Object.entries(tokens)) {
			const storedBuffer = Buffer.from(storedTokenStr);

			// Skip if lengths differ
			if (tokenBuffer.length !== storedBuffer.length) {
				continue;
			}

			// Use constant-time comparison
			try {
				if (timingSafeEqual(tokenBuffer, storedBuffer)) {
					// Verify client ownership
					if (storedToken.client_id === clientId) {
						return storedTokenStr;
					}
					return undefined; // Token found but wrong client
				}
			} catch {}
		}
		return undefined;
	};

	// If hint provided, check that type first
	if (tokenTypeHint === 'access_token') {
		tokenKey = findToken(storage.access_tokens);
		if (tokenKey) {
			delete storage.access_tokens[tokenKey];
			revoked = true;
		}
	} else if (tokenTypeHint === 'refresh_token') {
		tokenKey = findToken(storage.refresh_tokens);
		if (tokenKey) {
			delete storage.refresh_tokens[tokenKey];
			revoked = true;
		}
	}

	// If not found and no hint, or hint was wrong, check both types
	if (!revoked && !tokenTypeHint) {
		// Check access tokens
		tokenKey = findToken(storage.access_tokens);
		if (tokenKey) {
			delete storage.access_tokens[tokenKey];
			revoked = true;
		}

		// Check refresh tokens
		tokenKey = findToken(storage.refresh_tokens);
		if (tokenKey) {
			delete storage.refresh_tokens[tokenKey];
			revoked = true;
		}
	}

	if (revoked) {
		saveTokenStorage(storage);
	}

	return revoked;
}

/**
 * Revoke all tokens for a specific client.
 * Used when removing a client from the configuration.
 */
export function revokeClientTokens(clientId: string): number {
	const storage = loadTokenStorage();
	let revokedCount = 0;

	// Remove authorization codes
	for (const [code, authCode] of Object.entries(storage.authorization_codes)) {
		if (authCode.client_id === clientId) {
			delete storage.authorization_codes[code];
			revokedCount++;
		}
	}

	// Remove access tokens
	for (const [token, accessToken] of Object.entries(storage.access_tokens)) {
		if (accessToken.client_id === clientId) {
			delete storage.access_tokens[token];
			revokedCount++;
		}
	}

	// Remove refresh tokens
	for (const [token, refreshToken] of Object.entries(storage.refresh_tokens)) {
		if (refreshToken.client_id === clientId) {
			delete storage.refresh_tokens[token];
			revokedCount++;
		}
	}

	if (revokedCount > 0) {
		saveTokenStorage(storage);
	}

	return revokedCount;
}

/**
 * Clean up expired tokens.
 * Should be called periodically to prevent storage bloat.
 */
export function cleanupExpiredTokens(): {
	codes: number;
	tokens: number;
	csrfTokens: number;
	refreshTokens: number;
} {
	const storage = loadTokenStorage();
	const now = Date.now();
	let codesRemoved = 0;
	let tokensRemoved = 0;
	let csrfRemoved = 0;
	let refreshRemoved = 0;

	// Remove expired authorization codes
	for (const [code, authCode] of Object.entries(storage.authorization_codes)) {
		if (now > authCode.expires_at) {
			delete storage.authorization_codes[code];
			codesRemoved++;
		}
	}

	// Remove expired access tokens
	for (const [token, accessToken] of Object.entries(storage.access_tokens)) {
		if (now > accessToken.expires_at) {
			delete storage.access_tokens[token];
			tokensRemoved++;
		}
	}

	// Remove expired refresh tokens
	for (const [token, refreshToken] of Object.entries(storage.refresh_tokens)) {
		if (now > refreshToken.expires_at) {
			delete storage.refresh_tokens[token];
			refreshRemoved++;
		}
	}

	// Remove expired CSRF tokens
	for (const [token, csrfToken] of Object.entries(storage.csrf_tokens)) {
		if (now > csrfToken.expires_at) {
			delete storage.csrf_tokens[token];
			csrfRemoved++;
		}
	}

	if (codesRemoved > 0 || tokensRemoved > 0 || csrfRemoved > 0 || refreshRemoved > 0) {
		saveTokenStorage(storage);
	}

	return {
		codes: codesRemoved,
		tokens: tokensRemoved,
		csrfTokens: csrfRemoved,
		refreshTokens: refreshRemoved,
	};
}

/**
 * Get statistics about stored tokens.
 * Useful for the `mdq oauth status` command.
 */
export function getTokenStats(): {
	authCodes: { total: number; expired: number };
	accessTokens: { total: number; expired: number };
	refreshTokens: { total: number; expired: number };
} {
	const storage = loadTokenStorage();
	const now = Date.now();

	const authCodes = Object.values(storage.authorization_codes);
	const accessTokens = Object.values(storage.access_tokens);
	const refreshTokens = Object.values(storage.refresh_tokens);

	return {
		authCodes: {
			total: authCodes.length,
			expired: authCodes.filter((c) => now > c.expires_at).length,
		},
		accessTokens: {
			total: accessTokens.length,
			expired: accessTokens.filter((t) => now > t.expires_at).length,
		},
		refreshTokens: {
			total: refreshTokens.length,
			expired: refreshTokens.filter((t) => now > t.expires_at).length,
		},
	};
}

/**
 * Store a CSRF token for authorization form protection.
 * CSRF tokens expire after 10 minutes.
 */
export function storeCsrfToken(token: string): void {
	const storage = loadTokenStorage();

	const csrfToken: CsrfToken = {
		token,
		expires_at: Date.now() + CSRF_TOKEN_EXPIRY_MS,
	};

	storage.csrf_tokens[token] = csrfToken;
	saveTokenStorage(storage);
}

/**
 * Validate and consume a CSRF token.
 * Returns true if valid, false if invalid/expired.
 * Token is deleted after validation (single-use).
 */
export function validateCsrfToken(token: string): boolean {
	const storage = loadTokenStorage();

	const csrfToken = storage.csrf_tokens[token];
	if (!csrfToken) {
		return false;
	}

	// Check expiry
	if (Date.now() > csrfToken.expires_at) {
		// Clean up expired token
		delete storage.csrf_tokens[token];
		saveTokenStorage(storage);
		return false;
	}

	// Valid token - delete it (single-use)
	delete storage.csrf_tokens[token];
	saveTokenStorage(storage);
	return true;
}
