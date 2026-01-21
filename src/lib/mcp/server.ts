import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JSONSchema, Schema } from 'effect';
import packageJson from '../../../package.json';
import { handleRead, handleSearch } from './handlers.js';
import type { Source } from './sources.js';
import { ReadToolParams, SearchToolParams } from './tools.js';

export interface MdMcpServer {
	start(): Promise<void>;
	close(): Promise<void>;
}

export async function createMcpServer(sources: Source[]): Promise<MdMcpServer> {
	const server = new McpServer({
		name: 'md',
		version: packageJson.version,
	});

	const searchJsonSchema = JSONSchema.make(SearchToolParams);
	const readJsonSchema = JSONSchema.make(ReadToolParams);
	const decodeSearchParams = Schema.decodeUnknownSync(SearchToolParams);
	const decodeReadParams = Schema.decodeUnknownSync(ReadToolParams);

	// Build source map for quick lookup
	const sourceMap = new Map(sources.map((s) => [s.name, s]));
	const sourceNames = sources.map((s) => s.name);

	// Register search tool
	server.tool(
		'search',
		`Search indexed Markdown content. Returns matching pages with snippets.${sources.length > 1 ? ` Available sources: ${sourceNames.join(', ')}` : ''}`,
		searchJsonSchema,
		async (params) => {
			try {
				const parsed = decodeSearchParams(params);
				const result = await handleSearch(sources, sourceMap, {
					query: parsed.query,
					limit: parsed.limit,
					labels: parsed.labels ? [...parsed.labels] : undefined,
					author: parsed.author,
					source: parsed.source,
					created_after: parsed.created_after,
					created_before: parsed.created_before,
					created_within: parsed.created_within,
					updated_after: parsed.updated_after,
					updated_before: parsed.updated_before,
					updated_within: parsed.updated_within,
					stale: parsed.stale,
					sort: parsed.sort,
				});

				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[md] search error: ${message}`);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
					isError: true,
				};
			}
		},
	);

	// Register read tool
	server.tool(
		'read_page',
		`Read the full content of a specific Markdown page. Use either the path (from search results) or the page ID.${sources.length > 1 ? ` Specify source if ambiguous. Available sources: ${sourceNames.join(', ')}` : ''}`,
		readJsonSchema,
		async (params) => {
			try {
				const parsed = decodeReadParams(params);
				const result = await handleRead(sources, sourceMap, {
					path: parsed.path,
					id: parsed.id,
					source: parsed.source,
				});

				if (!result) {
					return {
						content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Page not found' }) }],
						isError: true,
					};
				}

				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[md] read error: ${message}`);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
					isError: true,
				};
			}
		},
	);

	const transport = new StdioServerTransport();

	return {
		async start() {
			const sourceList = sources.map((s) => `${s.name}:${s.path}`).join(', ');
			console.error(`[md] Starting MCP server for sources: ${sourceList}`);
			await server.connect(transport);
			console.error('[md] MCP server connected');
		},
		async close() {
			console.error('[md] Closing MCP server');
			await server.close();
		},
	};
}
