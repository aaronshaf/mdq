import { z } from 'zod';

// OAuth Client Configuration
export interface OAuthClient {
	client_id: string;
	client_secret: string;
	redirect_uris: string[];
	name: string;
}

export const OAuthClientSchema = z.object({
	client_id: z.string().min(1),
	client_secret: z.string().min(1),
	redirect_uris: z.array(z.string().url()),
	name: z.string().min(1),
});

export interface OAuthConfig {
	enabled: boolean;
	clients: OAuthClient[];
}

export const OAuthConfigSchema = z.object({
	enabled: z.boolean(),
	clients: z.array(OAuthClientSchema),
});

// Authorization Code
export interface AuthorizationCode {
	code: string;
	client_id: string;
	redirect_uri: string;
	code_challenge: string;
	code_challenge_method: string;
	expires_at: number;
	scope?: string;
}

export const AuthorizationCodeSchema = z.object({
	code: z.string().min(1),
	client_id: z.string().min(1),
	redirect_uri: z.string().url(),
	code_challenge: z.string().min(1),
	code_challenge_method: z.enum(['S256']),
	expires_at: z.number(),
	scope: z.string().optional(),
});

// Access Token
export interface AccessToken {
	token: string;
	client_id: string;
	scope: string;
	issued_at: number;
	expires_at: number;
}

export const AccessTokenSchema = z.object({
	token: z.string().min(1),
	client_id: z.string().min(1),
	scope: z.string(),
	issued_at: z.number(),
	expires_at: z.number(),
});

// CSRF Token
export interface CsrfToken {
	token: string;
	expires_at: number;
}

export const CsrfTokenSchema = z.object({
	token: z.string().min(1),
	expires_at: z.number(),
});

// Refresh Token
export interface RefreshToken {
	token: string;
	client_id: string;
	scope: string;
	issued_at: number;
	expires_at: number;
}

export const RefreshTokenSchema = z.object({
	token: z.string().min(1),
	client_id: z.string().min(1),
	scope: z.string(),
	issued_at: z.number(),
	expires_at: z.number(),
});

// Token Storage
export interface TokenStorage {
	authorization_codes: Record<string, AuthorizationCode>;
	access_tokens: Record<string, AccessToken>;
	csrf_tokens: Record<string, CsrfToken>;
	refresh_tokens: Record<string, RefreshToken>;
}

export const TokenStorageSchema = z.object({
	authorization_codes: z.record(z.string(), AuthorizationCodeSchema),
	access_tokens: z.record(z.string(), AccessTokenSchema),
	csrf_tokens: z.record(z.string(), CsrfTokenSchema),
	refresh_tokens: z.record(z.string(), RefreshTokenSchema),
});

// OAuth Request Schemas
export const AuthorizationRequestSchema = z.object({
	response_type: z.literal('code'),
	client_id: z.string().min(1),
	redirect_uri: z.string().url(),
	state: z.string().min(1),
	code_challenge: z.string().min(43).max(128),
	code_challenge_method: z.literal('S256'),
	scope: z.string().optional(),
});

export type AuthorizationRequest = z.infer<typeof AuthorizationRequestSchema>;

export const TokenRequestSchema = z.discriminatedUnion('grant_type', [
	z.object({
		grant_type: z.literal('authorization_code'),
		code: z.string().min(1),
		client_id: z.string().min(1),
		client_secret: z.string().min(1),
		redirect_uri: z.string().url(),
		code_verifier: z.string().min(43).max(128),
	}),
	z.object({
		grant_type: z.literal('refresh_token'),
		refresh_token: z.string().min(1),
		client_id: z.string().min(1),
		client_secret: z.string().min(1),
		scope: z.string().optional(),
	}),
]);

export type TokenRequest = z.infer<typeof TokenRequestSchema>;

export const RevokeRequestSchema = z.object({
	token: z.string().min(1),
	token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
	client_id: z.string().min(1),
	client_secret: z.string().min(1),
});

export type RevokeRequest = z.infer<typeof RevokeRequestSchema>;

// OAuth Response Types
export interface TokenResponse {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	refresh_token?: string;
	scope?: string;
}

export interface OAuthError {
	error: string;
	error_description?: string;
	error_uri?: string;
}

// OAuth Metadata Types
export interface ProtectedResourceMetadata {
	resource: string;
	authorization_servers: string[];
	scopes_supported?: string[];
	bearer_methods_supported?: string[];
}

export interface AuthorizationServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	revocation_endpoint?: string;
	response_types_supported: string[];
	grant_types_supported: string[];
	code_challenge_methods_supported: string[];
	token_endpoint_auth_methods_supported: string[];
	revocation_endpoint_auth_methods_supported?: string[];
}
