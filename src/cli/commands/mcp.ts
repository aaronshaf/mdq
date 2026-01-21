import { createMcpServer } from '../../lib/mcp/index.js';

export async function runMcpCommand(basePath: string): Promise<void> {
	const server = await createMcpServer(basePath);
	await server.start();
}
