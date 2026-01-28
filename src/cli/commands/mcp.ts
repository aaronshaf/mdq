import { EXIT_CODES } from '../../lib/errors.js';
import { createMcpServer } from '../../lib/mcp/index.js';
import type { Source } from '../../lib/mcp/sources.js';
import { createSearchClient, indexDirectory } from '../../lib/search/index.js';

export async function runMcpCommand(
	sources: Source[],
	httpOptions?: {
		enabled: boolean;
		port: number;
		host: string;
		apiKey: string;
		noAuth: boolean;
	},
): Promise<void> {
	const client = createSearchClient();

	// Check Meilisearch health before proceeding
	const health = await client.checkHealth();
	if (!health.healthy) {
		console.error(`[mdq] Error: ${health.message}`);
		process.exit(EXIT_CODES.CONNECTION_ERROR);
	}
	console.error(`[mdq] ${health.message}`);

	// If HTTP mode enabled, validate API key and route to HTTP server
	if (httpOptions?.enabled) {
		if (!httpOptions.noAuth) {
			if (!httpOptions.apiKey) {
				console.error(
					'Error: API key required for HTTP mode. Set MDQ_MCP_API_KEY or use --api-key',
				);
				console.error('Use --no-auth to disable authentication (for testing only)');
				process.exit(EXIT_CODES.INVALID_ARGS);
			}

			// Validate API key strength (minimum 16 characters for security)
			if (httpOptions.apiKey.length < 16) {
				console.error('Error: API key must be at least 16 characters long for security.');
				console.error('Generate a strong key with: openssl rand -hex 32');
				process.exit(EXIT_CODES.INVALID_ARGS);
			}
		}

		// Import and call HTTP server runner
		const { runHttpMcpServer } = await import('./mcp-http.js');
		await runHttpMcpServer(sources, client, httpOptions);
		return;
	}

	// Otherwise, use stdio mode (default behavior)

	// Auto-index all source directories in parallel
	console.error(`[mdq] Indexing ${sources.length} source(s)...`);
	const indexResults = await Promise.allSettled(
		sources.map(async (source) => {
			const result = await indexDirectory(source.path, client);
			return { source, result };
		}),
	);

	// Report results
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

	const server = await createMcpServer(sources, client);

	// Graceful shutdown on SIGINT/SIGTERM
	const shutdown = async () => {
		console.error('\n[mdq] Shutting down...');
		await server.close();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	await server.start();
}
