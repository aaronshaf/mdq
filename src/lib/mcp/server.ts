import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import packageJson from '../../../package.json';
import type { SearchClient } from '../search/index.js';
import { handleRead, handleSearch } from './handlers.js';
import type { Source } from './sources.js';
import {
	ReadToolParams,
	ReadToolParamsBaseShape,
	SearchToolParams,
	SearchToolParamsShape,
} from './tools.js';

export interface MdMcpServer {
	start(): Promise<void>;
	close(): Promise<void>;
}

/**
 * Creates an MCP server instance without a transport.
 * This allows the server to be used with different transports (stdio, HTTP, etc.)
 */
export async function createMcpServerInstance(
	sources: Source[],
	client: SearchClient,
): Promise<McpServer> {
	const server = new McpServer({
		name: 'md',
		version: packageJson.version,
	});

	// Build source map for quick lookup (keys are lowercased for case-insensitive lookup)
	const sourceMap = new Map(sources.map((s) => [s.name.toLowerCase(), s]));

	// Format source list for tool descriptions
	const formatSourceList = (): string => {
		if (sources.length <= 1) return '';
		const hasDescriptions = sources.some((s) => s.description);
		if (hasDescriptions) {
			const sourceLines = sources.map((s) =>
				s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`,
			);
			return `\n\nAvailable sources:\n${sourceLines.join('\n')}`;
		}
		return ` Available sources: ${sources.map((s) => s.name).join(', ')}`;
	};
	const sourceList = formatSourceList();

	// Register search tool
	server.tool(
		'search',
		`Search indexed Markdown content. Returns matching pages with snippets.

Each result includes:
- Basic metadata: id, title, path, created_at, updated_at, author_email, labels
- Content: snippet (excerpt from the document)
- Citation: reference (Chicago-style citation for the source, if available) - USE THIS FOR FOOTNOTES
- Smart indexing data (if available): summary

IMPORTANT: summary is AI-GENERATED and should NOT be quoted or cited as authoritative. Only quote directly from the document content or snippet. Use the reference field for proper citations.${sourceList}`,
		SearchToolParamsShape,
		async (params) => {
			try {
				// Validate and parse input
				const parseResult = SearchToolParams.safeParse(params);
				if (!parseResult.success) {
					const errorMsg = parseResult.error.issues[0]?.message ?? 'Invalid parameters';
					return {
						content: [{ type: 'text' as const, text: JSON.stringify({ error: errorMsg }) }],
						isError: true,
					};
				}

				const parsed = parseResult.data;
				const result = await handleSearch(sources, sourceMap, client, {
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
		`Read the full content of a specific Markdown page. Use either the path (from search results) or the page ID.${sources.length > 1 ? ` Specify source if ambiguous.${sourceList}` : ''}

Use this tool to get QUOTABLE TEXT for citations. The content field contains the full document text that can be directly quoted. The reference field (if available) provides the Chicago-style citation to use in footnotes.`,
		ReadToolParamsBaseShape,
		async (params) => {
			try {
				// Validate input (including refinement that path or id is required)
				const parseResult = ReadToolParams.safeParse(params);
				if (!parseResult.success) {
					const errorMsg = parseResult.error.issues[0]?.message ?? 'Invalid parameters';
					return {
						content: [{ type: 'text' as const, text: JSON.stringify({ error: errorMsg }) }],
						isError: true,
					};
				}

				const parsed = parseResult.data;
				const result = await handleRead(sources, sourceMap, client, {
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

	return server;
}

/**
 * Creates an MCP server with stdio transport (backward compatible).
 * This is the default mode for local CLI usage.
 */
export async function createMcpServer(
	sources: Source[],
	client: SearchClient,
): Promise<MdMcpServer> {
	const server = await createMcpServerInstance(sources, client);
	const transport = new StdioServerTransport();

	return {
		async start() {
			const sourceList = sources
				.map((s) =>
					s.description ? `${s.name}:${s.path} (${s.description})` : `${s.name}:${s.path}`,
				)
				.join(', ');
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
