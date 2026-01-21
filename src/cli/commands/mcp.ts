import { createMcpServer } from '../../lib/mcp/index.js';
import type { Source } from '../../lib/mcp/sources.js';

export async function runMcpCommand(sources: Source[]): Promise<void> {
	const server = await createMcpServer(sources);

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
