import type { AuthorizationServerMetadata, ProtectedResourceMetadata } from './types.js';

/**
 * Generate OAuth 2.1 Protected Resource Metadata.
 * See RFC 8414 and OAuth 2.1 Draft.
 *
 * @param baseUrl - The base URL of the server (e.g., "https://localhost:3000")
 * @returns Protected resource metadata object
 */
export function getProtectedResourceMetadata(baseUrl: string): ProtectedResourceMetadata {
	return {
		resource: `${baseUrl}/mcp`,
		authorization_servers: [baseUrl],
		scopes_supported: ['mcp'],
		bearer_methods_supported: ['header'],
	};
}

/**
 * Generate OAuth 2.1 Authorization Server Metadata.
 * See RFC 8414 and OAuth 2.1 Draft.
 *
 * @param baseUrl - The base URL of the server (e.g., "https://localhost:3000")
 * @returns Authorization server metadata object
 */
export function getAuthorizationServerMetadata(baseUrl: string): AuthorizationServerMetadata {
	return {
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/oauth/authorize`,
		token_endpoint: `${baseUrl}/oauth/token`,
		revocation_endpoint: `${baseUrl}/oauth/revoke`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['client_secret_post'],
		revocation_endpoint_auth_methods_supported: ['client_secret_post'],
	};
}
