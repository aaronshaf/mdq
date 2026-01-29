import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import {
	corsHeaders,
	createAuthError,
	createCorsPreflightResponse,
	createHttpTransportManager,
	validateRequest,
} from '../../lib/mcp/http.js';
import { createMcpServerInstance } from '../../lib/mcp/server.js';
import type { Source } from '../../lib/mcp/sources.js';
import { renderAuthorizationPage } from '../../lib/oauth/authorization.js';
import { getOAuthClient, isOAuthEnabled } from '../../lib/oauth/config.js';
import {
	getAuthorizationServerMetadata,
	getProtectedResourceMetadata,
} from '../../lib/oauth/metadata.js';
import { validateCodeChallenge } from '../../lib/oauth/pkce.js';
import {
	exchangeAuthCode,
	generateToken,
	refreshAccessToken,
	revokeToken,
	storeAuthCode,
	storeCsrfToken,
	validateAccessToken,
	validateCsrfToken,
} from '../../lib/oauth/tokens.js';
import {
	AuthorizationRequestSchema,
	type OAuthError,
	RevokeRequestSchema,
	TokenRequestSchema,
	type TokenResponse,
} from '../../lib/oauth/types.js';
import type { SearchClient } from '../../lib/search/index.js';
import { indexDirectory } from '../../lib/search/index.js';

// Import using the SDK's wildcard export pattern
// The SDK package.json includes: "./*": { "import": "./dist/esm/*" }
// which allows importing internal modules directly
async function loadWebStandardTransport() {
	try {
		const module = await import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js');
		if (!module.WebStandardStreamableHTTPServerTransport) {
			throw new Error('WebStandardStreamableHTTPServerTransport not found in module');
		}
		return module.WebStandardStreamableHTTPServerTransport;
	} catch (error) {
		// Enhanced error reporting for better diagnostics
		let errorMsg: string;
		if (error instanceof Error) {
			errorMsg = error.message;
		} else {
			errorMsg = `Non-Error thrown: ${JSON.stringify(error)}`;
		}

		throw new Error(
			`Failed to load MCP HTTP transport. This may be due to an incompatible MCP SDK version. Expected: @modelcontextprotocol/sdk@^1.25.3. Error: ${errorMsg}`,
		);
	}
}

// Rate limiting for token endpoint
const tokenAttempts = new Map<string, { count: number; resetAt: number }>();
const TOKEN_RATE_LIMIT = 5; // Max failed attempts
const TOKEN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minute cooldown
const RATE_LIMIT_CLEANUP_INTERVAL = 60 * 60 * 1000; // Cleanup every hour

function checkRateLimit(clientId: string): boolean {
	const now = Date.now();
	const attempts = tokenAttempts.get(clientId);

	if (!attempts || now > attempts.resetAt) {
		return true; // No rate limit
	}

	return attempts.count < TOKEN_RATE_LIMIT;
}

function recordFailedAttempt(clientId: string): void {
	const now = Date.now();
	const attempts = tokenAttempts.get(clientId);

	if (!attempts || now > attempts.resetAt) {
		tokenAttempts.set(clientId, { count: 1, resetAt: now + TOKEN_COOLDOWN_MS });
	} else {
		attempts.count++;
	}
}

function recordSuccessAttempt(clientId: string): void {
	tokenAttempts.delete(clientId);
}

function cleanupRateLimitMap(): void {
	const now = Date.now();
	for (const [clientId, attempts] of tokenAttempts.entries()) {
		if (now > attempts.resetAt) {
			tokenAttempts.delete(clientId);
		}
	}
}

function startRateLimitCleanup(): NodeJS.Timeout {
	return setInterval(cleanupRateLimitMap, RATE_LIMIT_CLEANUP_INTERVAL);
}

export async function runHttpMcpServer(
	sources: Source[],
	client: SearchClient,
	options: {
		port: number;
		host: string;
		apiKey: string;
		noAuth: boolean;
		oauth: boolean;
		verbose: boolean;
		cert?: string;
		key?: string;
		publicUrl?: string;
	},
): Promise<void> {
	// Check OAuth requirements
	const oauthEnabled = options.oauth && isOAuthEnabled();
	if (options.oauth && !oauthEnabled) {
		console.error('Error: OAuth flag provided but no OAuth clients configured.');
		console.error('Run "mdq oauth setup" to create an OAuth client first.');
		process.exit(1);
	}

	// Check if HTTPS is configured
	const isHttps = !!(options.cert && options.key);

	// OAuth over HTTP: only allow if binding to localhost (reverse proxy assumed)
	if (oauthEnabled && !isHttps) {
		// Prevent accidental exposure: require localhost binding when using HTTP OAuth
		const isLocalhost =
			options.host === '127.0.0.1' || options.host === 'localhost' || options.host === '::1';

		if (!isLocalhost) {
			console.error('Error: OAuth over HTTP requires binding to localhost for security.');
			console.error(`Currently binding to: ${options.host}`);
			console.error('');
			console.error('Options:');
			console.error(
				'  1. Bind to localhost: --host 127.0.0.1 or --host ::1 (for HTTPS reverse proxy)',
			);
			console.error('  2. Use HTTPS directly: --cert ./cert.pem --key ./key.pem');
			console.error('');
			console.error('This prevents accidentally exposing OAuth over HTTP to the internet.');
			process.exit(1);
		}

		// Warning for localhost HTTP OAuth (reverse proxy assumed)
		console.error('[mdq] WARNING: OAuth over HTTP on localhost (reverse proxy assumed)');
		console.error(
			'[mdq] Ensure an HTTPS reverse proxy (Cloudflare Tunnel, nginx) is forwarding to this server',
		);
	}

	// Load TLS certificate if provided
	let tlsOptions: { cert: string; key: string } | undefined;
	if (options.cert && options.key) {
		try {
			const cert = fs.readFileSync(options.cert, 'utf-8');
			const key = fs.readFileSync(options.key, 'utf-8');
			tlsOptions = { cert, key };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Error: Failed to load TLS certificate: ${message}`);
			process.exit(1);
		}
	}

	// Build base URL for OAuth metadata
	// Use publicUrl if provided (for reverse proxy), otherwise use local host:port
	const protocol = isHttps ? 'https' : 'http';
	const baseUrl = options.publicUrl
		? options.publicUrl.replace(/\/+$/, '') // Remove trailing slashes
		: `${protocol}://${options.host}:${options.port}`;

	// Create MCP server instance (shared across all sessions)
	const mcpServer = await createMcpServerInstance(sources, client);
	const transportManager = createHttpTransportManager();

	// Load the WebStandardStreamableHTTPServerTransport class
	const WebStandardStreamableHTTPServerTransport = await loadWebStandardTransport();

	// Create fetch handler for Bun.serve
	const fetchHandler = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);

		// Verbose logging for all requests
		if (options.verbose) {
			console.error(`[mdq] ${req.method} ${url.pathname}`);
		}

		// Handle CORS preflight requests
		if (req.method === 'OPTIONS') {
			if (options.verbose) {
				console.error('[mdq] CORS preflight request');
			}
			return createCorsPreflightResponse();
		}

		// OAuth Discovery: Protected Resource Metadata
		if (url.pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
			if (!oauthEnabled) {
				return new Response('Not Found', { status: 404 });
			}
			if (options.verbose) {
				console.error('[mdq] OAuth discovery: protected resource metadata requested');
			}
			const metadata = getProtectedResourceMetadata(baseUrl);
			return new Response(JSON.stringify(metadata), {
				headers: { 'Content-Type': 'application/json', ...corsHeaders() },
			});
		}

		// OAuth Discovery: Authorization Server Metadata
		if (url.pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
			if (!oauthEnabled) {
				return new Response('Not Found', { status: 404 });
			}
			if (options.verbose) {
				console.error('[mdq] OAuth discovery: authorization server metadata requested');
			}
			const metadata = getAuthorizationServerMetadata(baseUrl);
			return new Response(JSON.stringify(metadata), {
				headers: { 'Content-Type': 'application/json', ...corsHeaders() },
			});
		}

		// OAuth Authorization Endpoint (GET - display authorization page)
		if (url.pathname === '/oauth/authorize' && req.method === 'GET') {
			if (!oauthEnabled) {
				return new Response('Not Found', { status: 404 });
			}

			try {
				// Parse query parameters
				const params = Object.fromEntries(url.searchParams.entries());
				const validated = AuthorizationRequestSchema.parse(params);

				// Validate client_id
				const client = getOAuthClient(validated.client_id);
				if (!client) {
					const error: OAuthError = {
						error: 'invalid_client',
						error_description: 'Client not found',
					};
					return new Response(JSON.stringify(error), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Validate redirect_uri
				if (!client.redirect_uris.includes(validated.redirect_uri)) {
					const error: OAuthError = {
						error: 'invalid_request',
						error_description: 'Invalid redirect_uri',
					};
					return new Response(JSON.stringify(error), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Generate authorization code and CSRF token
				const code = generateToken(32);
				const csrfToken = generateToken(32);

				// Store CSRF token for form protection
				storeCsrfToken(csrfToken);

				// Temporarily store authorization request data (not the code itself yet)
				// Code will be stored only after user approval
				storeAuthCode(code, {
					client_id: validated.client_id,
					redirect_uri: validated.redirect_uri,
					code_challenge: validated.code_challenge,
					code_challenge_method: validated.code_challenge_method,
					scope: validated.scope,
				});

				// Render authorization page
				const html = renderAuthorizationPage({
					clientName: client.name,
					clientId: client.client_id,
					redirectUri: validated.redirect_uri,
					state: validated.state,
					code,
					csrfToken,
					scope: validated.scope,
				});

				return new Response(html, {
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			} catch (error) {
				const oauthError: OAuthError = {
					error: 'invalid_request',
					error_description: error instanceof Error ? error.message : 'Invalid request parameters',
				};
				return new Response(JSON.stringify(oauthError), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// OAuth Authorization Endpoint (POST - process approval/denial)
		if (url.pathname === '/oauth/authorize' && req.method === 'POST') {
			if (!oauthEnabled) {
				return new Response('Not Found', { status: 404 });
			}

			try {
				const formData = await req.formData();
				const action = formData.get('action');
				const code = formData.get('code');
				const state = formData.get('state');
				const redirectUri = formData.get('redirect_uri');
				const csrfToken = formData.get('csrf_token');

				if (
					typeof action !== 'string' ||
					typeof code !== 'string' ||
					typeof state !== 'string' ||
					typeof redirectUri !== 'string' ||
					typeof csrfToken !== 'string'
				) {
					throw new Error('Missing form parameters');
				}

				// Validate CSRF token
				if (!validateCsrfToken(csrfToken)) {
					throw new Error('Invalid or expired CSRF token');
				}

				if (action === 'deny') {
					// User denied - redirect with error
					const errorUrl = new URL(redirectUri);
					errorUrl.searchParams.set('error', 'access_denied');
					errorUrl.searchParams.set('error_description', 'User denied the request');
					errorUrl.searchParams.set('state', state);

					return new Response(null, {
						status: 302,
						headers: { Location: errorUrl.toString() },
					});
				}

				if (action === 'approve') {
					// User approved - redirect with authorization code
					const successUrl = new URL(redirectUri);
					successUrl.searchParams.set('code', code);
					successUrl.searchParams.set('state', state);

					return new Response(null, {
						status: 302,
						headers: { Location: successUrl.toString() },
					});
				}

				throw new Error('Invalid action');
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Invalid request';
				return new Response(`Bad Request: ${message}`, { status: 400 });
			}
		}

		// OAuth Token Endpoint
		if (url.pathname === '/oauth/token' && req.method === 'POST') {
			if (!oauthEnabled) {
				return new Response('Not Found', { status: 404 });
			}

			try {
				const formData = await req.formData();
				const params = Object.fromEntries(formData.entries());
				const validated = TokenRequestSchema.parse(params);

				// Check rate limit
				if (!checkRateLimit(validated.client_id)) {
					recordFailedAttempt(validated.client_id);
					const error: OAuthError = {
						error: 'temporarily_unavailable',
						error_description: 'Too many failed attempts. Please try again later.',
					};
					return new Response(JSON.stringify(error), {
						status: 503,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Validate client credentials with constant-time comparison
				const client = getOAuthClient(validated.client_id);
				if (!client) {
					recordFailedAttempt(validated.client_id);
					const error: OAuthError = {
						error: 'invalid_client',
						error_description: 'Invalid client credentials',
					};
					return new Response(JSON.stringify(error), {
						status: 401,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Use constant-time comparison to prevent timing attacks
				const clientSecretBuffer = Buffer.from(client.client_secret);
				const providedSecretBuffer = Buffer.from(validated.client_secret);

				if (
					clientSecretBuffer.length !== providedSecretBuffer.length ||
					!timingSafeEqual(clientSecretBuffer, providedSecretBuffer)
				) {
					recordFailedAttempt(validated.client_id);
					const error: OAuthError = {
						error: 'invalid_client',
						error_description: 'Invalid client credentials',
					};
					return new Response(JSON.stringify(error), {
						status: 401,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Handle different grant types
				if (validated.grant_type === 'authorization_code') {
					// Validate redirect_uri matches
					if (!client.redirect_uris.includes(validated.redirect_uri)) {
						recordFailedAttempt(validated.client_id);
						const error: OAuthError = {
							error: 'invalid_grant',
							error_description: 'Invalid redirect_uri',
						};
						return new Response(JSON.stringify(error), {
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						});
					}

					// Exchange authorization code for access token and refresh token
					const tokens = exchangeAuthCode(
						validated.code,
						validated.code_verifier,
						validateCodeChallenge,
					);

					if (!tokens) {
						recordFailedAttempt(validated.client_id);
						const error: OAuthError = {
							error: 'invalid_grant',
							error_description: 'Invalid or expired authorization code',
						};
						return new Response(JSON.stringify(error), {
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						});
					}

					// Success - clear rate limit
					recordSuccessAttempt(validated.client_id);

					// Calculate actual expires_in from token data
					const expiresIn = Math.floor((tokens.accessToken.expires_at - Date.now()) / 1000);

					const tokenResponse: TokenResponse = {
						access_token: tokens.accessToken.token,
						token_type: 'Bearer',
						expires_in: expiresIn,
						refresh_token: tokens.refreshToken.token,
						scope: tokens.accessToken.scope || undefined,
					};

					return new Response(JSON.stringify(tokenResponse), {
						headers: { 'Content-Type': 'application/json' },
					});
				}
				if (validated.grant_type === 'refresh_token') {
					// Refresh token grant type
					const newAccessToken = refreshAccessToken(
						validated.refresh_token,
						validated.client_id,
						validated.scope,
					);

					if (!newAccessToken) {
						recordFailedAttempt(validated.client_id);
						const error: OAuthError = {
							error: 'invalid_grant',
							error_description: 'Invalid or expired refresh token',
						};
						return new Response(JSON.stringify(error), {
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						});
					}

					// Success - clear rate limit
					recordSuccessAttempt(validated.client_id);

					// Calculate actual expires_in from token data
					const expiresIn = Math.floor((newAccessToken.expires_at - Date.now()) / 1000);

					const tokenResponse: TokenResponse = {
						access_token: newAccessToken.token,
						token_type: 'Bearer',
						expires_in: expiresIn,
						scope: newAccessToken.scope || undefined,
					};

					return new Response(JSON.stringify(tokenResponse), {
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Unknown grant type (should not happen due to schema validation)
				throw new Error('Unsupported grant_type');
			} catch (error) {
				const oauthError: OAuthError = {
					error: 'invalid_request',
					error_description: error instanceof Error ? error.message : 'Invalid request',
				};
				return new Response(JSON.stringify(oauthError), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// OAuth Revoke Endpoint (RFC 7009)
		if (url.pathname === '/oauth/revoke' && req.method === 'POST') {
			if (!oauthEnabled) {
				return new Response('Not Found', { status: 404 });
			}

			try {
				const formData = await req.formData();
				const params = Object.fromEntries(formData.entries());
				const validated = RevokeRequestSchema.parse(params);

				// Validate client credentials with constant-time comparison
				const client = getOAuthClient(validated.client_id);
				if (!client) {
					const error: OAuthError = {
						error: 'invalid_client',
						error_description: 'Invalid client credentials',
					};
					return new Response(JSON.stringify(error), {
						status: 401,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Use constant-time comparison to prevent timing attacks
				const clientSecretBuffer = Buffer.from(client.client_secret);
				const providedSecretBuffer = Buffer.from(validated.client_secret);

				if (
					clientSecretBuffer.length !== providedSecretBuffer.length ||
					!timingSafeEqual(clientSecretBuffer, providedSecretBuffer)
				) {
					const error: OAuthError = {
						error: 'invalid_client',
						error_description: 'Invalid client credentials',
					};
					return new Response(JSON.stringify(error), {
						status: 401,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Revoke the token
				// Per RFC 7009, the authorization server responds with HTTP status code 200
				// regardless of whether the token was successfully revoked
				revokeToken(validated.token, validated.client_id, validated.token_type_hint);

				// Success response (empty body, 200 OK) with CORS headers
				return new Response(null, {
					status: 200,
					headers: corsHeaders(),
				});
			} catch (error) {
				const oauthError: OAuthError = {
					error: 'invalid_request',
					error_description: error instanceof Error ? error.message : 'Invalid request',
				};
				return new Response(JSON.stringify(oauthError), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// Health check endpoint (no auth required)
		if (url.pathname === '/health' && req.method === 'GET') {
			return new Response(JSON.stringify({ status: 'ok' }), {
				headers: { 'Content-Type': 'application/json', ...corsHeaders() },
			});
		}

		// All /mcp endpoints require authentication (unless --no-auth)
		if (url.pathname === '/mcp') {
			if (!options.noAuth) {
				const isValid = validateRequest(req, {
					oauthEnabled,
					bearerToken: options.apiKey,
					validateOAuthToken: oauthEnabled
						? (token: string) => {
								const tokenData = validateAccessToken(token);
								if (options.verbose) {
									console.error(`[mdq] OAuth token validation: ${tokenData ? 'valid' : 'invalid'}`);
								}
								return tokenData !== undefined;
							}
						: undefined,
				});

				if (!isValid) {
					console.error('[mdq] Authentication failed');
					return createAuthError(oauthEnabled ? baseUrl : undefined);
				}
				if (options.verbose) {
					console.error('[mdq] Authentication successful');
				}
			}

			// Get session ID from header
			const sessionIdFromHeader = req.headers.get('Mcp-Session-Id');

			// Handle DELETE - close session
			if (req.method === 'DELETE') {
				if (sessionIdFromHeader) {
					const existingTransport = transportManager.transports.get(sessionIdFromHeader);
					if (existingTransport) {
						await existingTransport.close();
						transportManager.transports.delete(sessionIdFromHeader);
						transportManager.lastActivity.delete(sessionIdFromHeader);
						console.error(`[mdq] Session closed: ${sessionIdFromHeader}`);
					}
				}
				return new Response(null, { status: 200, headers: corsHeaders() });
			}

			// Get or create transport for this session
			let transport = sessionIdFromHeader
				? transportManager.transports.get(sessionIdFromHeader)
				: undefined;

			if (!transport) {
				if (options.verbose) {
					console.error('[mdq] Creating new MCP session');
				}
				// Create new transport with session ID generator and callback
				// Capture in const to avoid closure issues with the let variable
				const newTransport = new WebStandardStreamableHTTPServerTransport({
					sessionIdGenerator: () => crypto.randomUUID(),
					onsessioninitialized: (sessionId: string) => {
						// Store transport when session is actually initialized
						transportManager.transports.set(sessionId, newTransport);
						transportManager.touch(sessionId);
						console.error(`[mdq] New session created: ${sessionId}`);
					},
				});
				transport = newTransport;

				// Connect transport to server
				await mcpServer.connect(transport);
			} else if (sessionIdFromHeader) {
				// Update activity for existing session
				transportManager.touch(sessionIdFromHeader);
			}

			// Handle POST/GET - delegate to transport
			try {
				const response = await transport.handleRequest(req);
				// Add CORS headers to transport response
				const headers = new Headers(response.headers);
				for (const [key, value] of Object.entries(corsHeaders())) {
					headers.set(key, value);
				}
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers,
				});
			} catch (error) {
				console.error('[mdq] Error handling request:', error);
				return new Response(JSON.stringify({ error: 'Internal server error' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...corsHeaders() },
				});
			}
		}

		// 404 for unknown paths
		return new Response('Not Found', { status: 404, headers: corsHeaders() });
	};

	// Start HTTP/HTTPS server
	const server = Bun.serve({
		port: options.port,
		hostname: options.host,
		fetch: fetchHandler,
		...(tlsOptions ? { tls: tlsOptions } : {}),
	});

	const sourceList = sources
		.map((s) => (s.description ? `${s.name}:${s.path} (${s.description})` : `${s.name}:${s.path}`))
		.join(', ');

	console.error(`[mdq] ${protocol.toUpperCase()} MCP server started for sources: ${sourceList}`);
	console.error(`[mdq] Listening on ${protocol}://${options.host}:${options.port}/mcp`);
	console.error(`[mdq] Health check: ${protocol}://${options.host}:${options.port}/health`);

	if (oauthEnabled) {
		console.error('[mdq] OAuth: ENABLED');
		console.error(`[mdq] Authorization endpoint: ${baseUrl}/oauth/authorize`);
		console.error(`[mdq] Token endpoint: ${baseUrl}/oauth/token`);
		console.error('[mdq] Discovery: /.well-known/oauth-protected-resource');
	}

	if (options.noAuth) {
		console.error('[mdq] Authentication: DISABLED (--no-auth)');
		console.error('[mdq] WARNING: Server is running without authentication!');
	} else {
		const authMethods = [];
		if (oauthEnabled) authMethods.push('OAuth 2.1');
		authMethods.push('Bearer token');
		console.error(`[mdq] Authentication: ${authMethods.join(' or ')}`);
	}

	// Security warning for non-localhost binding
	if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
		console.error('[mdq] WARNING: Server is binding to non-localhost address.');
		console.error('[mdq] Ensure your firewall and network are properly configured.');
	}

	// Start rate limit cleanup interval
	const rateLimitCleanupInterval = startRateLimitCleanup();

	// Auto-index all source directories in background (non-blocking)
	// Server is already running and usable while indexing happens
	console.error(`[mdq] Starting background indexing for ${sources.length} source(s)...`);
	Promise.allSettled(
		sources.map(async (source) => {
			const result = await indexDirectory(source.path, client);
			return { source, result };
		}),
	).then((indexResults) => {
		for (const outcome of indexResults) {
			if (outcome.status === 'fulfilled') {
				const { source, result } = outcome.value;
				console.error(`[mdq] Indexed ${result.indexed} documents from ${source.name}`);
			} else {
				const reason =
					outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
				console.error(`[mdq] Warning: Indexing failed: ${reason}`);
			}
		}
		console.error('[mdq] Background indexing complete');
	});

	// Graceful shutdown
	const shutdown = async () => {
		console.error('\n[mdq] Shutting down HTTP server...');
		clearInterval(rateLimitCleanupInterval);
		server.stop();
		await transportManager.cleanup();
		await mcpServer.close();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}
