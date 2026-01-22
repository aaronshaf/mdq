import { EXIT_CODES } from '../../lib/errors.js';
import { createMcpServer } from '../../lib/mcp/index.js';
import type { Source } from '../../lib/mcp/sources.js';
import { createSearchClient, indexDirectory } from '../../lib/search/index.js';

export async function runMcpCommand(sources: Source[]): Promise<void> {
	const client = createSearchClient();

	// Check Meilisearch health before proceeding
	const health = await client.checkHealth();
	if (!health.healthy) {
		console.error(`[md] Error: ${health.message}`);
		process.exit(EXIT_CODES.CONNECTION_ERROR);
	}
	console.error(`[md] ${health.message}`);

	// Auto-index all source directories in parallel
	console.error(`[md] Indexing ${sources.length} source(s)...`);
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
			console.error(`[md] Indexed ${result.indexed} documents from ${source.name}`);
		} else {
			const reason =
				outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
			console.error(`[md] Warning: Indexing failed: ${reason}`);
		}
	}

	const server = await createMcpServer(sources, client);

	// Graceful shutdown on SIGINT/SIGTERM
	const shutdown = async () => {
		console.error('\n[md] Shutting down...');
		await server.close();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	await server.start();
}
