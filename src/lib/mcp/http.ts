import { timingSafeEqual } from 'node:crypto';

// Type alias for the transport (will be loaded dynamically)
// biome-ignore lint/suspicious/noExplicitAny: Transport type loaded dynamically from MCP SDK
export type WebStandardStreamableHTTPServerTransport = any;

// Session timeout in milliseconds (default: 30 minutes)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute

export interface HttpTransportManager {
	// biome-ignore lint/suspicious/noExplicitAny: Transport type loaded dynamically from MCP SDK
	transports: Map<string, any>;
	lastActivity: Map<string, number>; // Track last activity per session
	cleanup: () => Promise<void>;
	touch: (sessionId: string) => void; // Update last activity
}

export function createHttpTransportManager(): HttpTransportManager {
	const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
	const lastActivity = new Map<string, number>();

	// Periodic cleanup of stale sessions
	const cleanupInterval = setInterval(async () => {
		const now = Date.now();
		for (const [sessionId, lastTime] of lastActivity.entries()) {
			if (now - lastTime > SESSION_TIMEOUT_MS) {
				const transport = transports.get(sessionId);
				if (transport) {
					try {
						await transport.close();
					} catch {
						// Ignore close errors for stale sessions
					}
					transports.delete(sessionId);
					lastActivity.delete(sessionId);
					console.error(`[mdq] Session timed out: ${sessionId}`);
				}
			}
		}
	}, SESSION_CLEANUP_INTERVAL_MS);

	return {
		transports,
		lastActivity,
		touch: (sessionId: string) => {
			lastActivity.set(sessionId, Date.now());
		},
		cleanup: async () => {
			clearInterval(cleanupInterval);
			for (const transport of transports.values()) {
				await transport.close();
			}
			transports.clear();
			lastActivity.clear();
		},
	};
}

export function validateBearerToken(req: Request, expectedToken: string): boolean {
	const auth = req.headers.get('Authorization');
	if (!auth) return false;

	const [type, token] = auth.split(' ');
	if (type !== 'Bearer' || !token) return false;

	// Use constant-time comparison to prevent timing attacks
	const tokenBuffer = Buffer.from(token);
	const expectedBuffer = Buffer.from(expectedToken);

	// Different lengths indicate different tokens
	if (tokenBuffer.length !== expectedBuffer.length) return false;

	// Use constant-time comparison from crypto module to prevent timing attacks
	return timingSafeEqual(tokenBuffer, expectedBuffer);
}

/**
 * Validate request authentication.
 * Checks OAuth access token first (if enabled), then falls back to Bearer token.
 *
 * @param req - The HTTP request
 * @param options - Authentication options
 * @returns true if authenticated, false otherwise
 */
export function validateRequest(
	req: Request,
	options: {
		oauthEnabled: boolean;
		bearerToken: string;
		validateOAuthToken?: (token: string) => boolean;
	},
): boolean {
	const auth = req.headers.get('Authorization');
	if (!auth) return false;

	const [type, token] = auth.split(' ');
	if (type !== 'Bearer' || !token) return false;

	// Try OAuth token validation first if enabled
	if (options.oauthEnabled && options.validateOAuthToken) {
		if (options.validateOAuthToken(token)) {
			return true;
		}
	}

	// Fall back to Bearer token validation
	return validateBearerToken(req, options.bearerToken);
}

export function createAuthError(baseUrl?: string): Response {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...corsHeaders(),
	};

	// Add WWW-Authenticate header with OAuth metadata link if available
	if (baseUrl) {
		headers['WWW-Authenticate'] = `Bearer realm="${baseUrl}/mcp"`;
		headers.Link = `<${baseUrl}/.well-known/oauth-protected-resource>; rel="oauth-protected-resource"`;
	}

	return new Response(
		JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing API key' }),
		{ status: 401, headers },
	);
}

// CORS headers for browser-based clients (Claude web UI)
// Configurable via MDQ_MCP_CORS_ORIGIN env var (default: restrictive)
export function corsHeaders(): Record<string, string> {
	// Default to claude.ai only; use '*' for development/testing
	const allowedOrigin = process.env.MDQ_MCP_CORS_ORIGIN ?? 'https://claude.ai';
	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
		'Access-Control-Expose-Headers': 'Mcp-Session-Id',
	};
}

export function createCorsPreflightResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: corsHeaders(),
	});
}
