import {
	corsHeaders,
	createAuthError,
	createCorsPreflightResponse,
	createHttpTransportManager,
	validateBearerToken,
} from '../../lib/mcp/http.js';
import { createMcpServerInstance } from '../../lib/mcp/server.js';
import type { Source } from '../../lib/mcp/sources.js';
import type { SearchClient } from '../../lib/search/index.js';
import { indexDirectory } from '../../lib/search/index.js';

// Dynamic import to work around MCP SDK not exporting this module in package.json
// See: https://github.com/modelcontextprotocol/sdk/issues/XXX (pending upstream fix)
// This path may break with different package managers (pnpm, monorepos) or SDK versions.
// Requires @modelcontextprotocol/sdk@^1.25.3
async function loadWebStandardTransport() {
	// Use absolute path from project root to import the module
	const modulePath = new URL(
		'../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js',
		import.meta.url,
	).pathname;

	try {
		const module = await import(modulePath);
		if (!module.WebStandardStreamableHTTPServerTransport) {
			throw new Error('WebStandardStreamableHTTPServerTransport not found in module');
		}
		return module.WebStandardStreamableHTTPServerTransport;
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : 'Unknown error loading MCP HTTP transport';
		throw new Error(
			`Failed to load MCP HTTP transport. This may be due to an incompatible MCP SDK version. Expected: @modelcontextprotocol/sdk@^1.25.3. Error: ${errorMsg}`,
		);
	}
}

export async function runHttpMcpServer(
	sources: Source[],
	client: SearchClient,
	options: {
		port: number;
		host: string;
		apiKey: string;
		noAuth: boolean;
	},
): Promise<void> {
	// Create MCP server instance (shared across all sessions)
	const mcpServer = await createMcpServerInstance(sources, client);
	const transportManager = createHttpTransportManager();

	// Load the WebStandardStreamableHTTPServerTransport class
	const WebStandardStreamableHTTPServerTransport = await loadWebStandardTransport();

	// Create fetch handler for Bun.serve
	const fetchHandler = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);

		// Handle CORS preflight requests
		if (req.method === 'OPTIONS') {
			return createCorsPreflightResponse();
		}

		// Health check endpoint (no auth required)
		if (url.pathname === '/health' && req.method === 'GET') {
			return new Response(JSON.stringify({ status: 'ok' }), {
				headers: { 'Content-Type': 'application/json', ...corsHeaders() },
			});
		}

		// All /mcp endpoints require authentication (unless --no-auth)
		if (url.pathname === '/mcp') {
			if (!options.noAuth && !validateBearerToken(req, options.apiKey)) {
				console.error('[mdq] Authentication failed');
				return createAuthError();
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

	// Start HTTP server
	const server = Bun.serve({
		port: options.port,
		hostname: options.host,
		fetch: fetchHandler,
	});

	const sourceList = sources
		.map((s) => (s.description ? `${s.name}:${s.path} (${s.description})` : `${s.name}:${s.path}`))
		.join(', ');

	console.error(`[mdq] HTTP MCP server started for sources: ${sourceList}`);
	console.error(`[mdq] Listening on http://${options.host}:${options.port}/mcp`);
	console.error(`[mdq] Health check: http://${options.host}:${options.port}/health`);
	if (options.noAuth) {
		console.error('[mdq] Authentication: DISABLED (--no-auth)');
		console.error('[mdq] WARNING: Server is running without authentication!');
	} else {
		console.error('[mdq] Authentication: Bearer token required');
	}

	// Security warning for non-localhost binding
	if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
		console.error('[mdq] WARNING: Server is binding to non-localhost address.');
		console.error('[mdq] Ensure your firewall and network are properly configured.');
	}

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
		server.stop();
		await transportManager.cleanup();
		await mcpServer.close();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}
