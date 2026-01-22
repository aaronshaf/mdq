import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const SearchToolParams = z.object({
	query: z.string().describe('Search query (supports typo tolerance)'),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.default(10)
		.describe('Maximum results to return'),
	source: z.string().optional().describe('Filter by source name (omit to search all sources)'),
	labels: z.array(z.string()).optional().describe('Filter by labels (OR logic)'),
	author: z.string().optional().describe('Filter by author email'),
	created_after: z.string().optional().describe('Filter: created after date (YYYY-MM-DD)'),
	created_before: z.string().optional().describe('Filter: created before date (YYYY-MM-DD)'),
	created_within: z
		.string()
		.optional()
		.describe('Filter: created within duration (e.g., 30d, 2w, 3m, 1y)'),
	updated_after: z.string().optional().describe('Filter: updated after date (YYYY-MM-DD)'),
	updated_before: z.string().optional().describe('Filter: updated before date (YYYY-MM-DD)'),
	updated_within: z
		.string()
		.optional()
		.describe('Filter: updated within duration (e.g., 7d, 2w, 1m)'),
	stale: z
		.string()
		.optional()
		.describe('Filter: NOT updated within duration - find stale content (e.g., 90d, 6m)'),
	sort: z
		.enum(['created_at', '-created_at', 'updated_at', '-updated_at'])
		.optional()
		.describe('Sort order (prefix with - for descending)'),
});

// Base schema for read tool (used for MCP tool registration)
export const ReadToolParamsBase = z.object({
	path: z
		.string()
		.optional()
		.describe('Relative path to the markdown file (e.g., "getting-started/authentication.md")'),
	id: z.string().optional().describe('Page ID from frontmatter or search results'),
	source: z
		.string()
		.optional()
		.describe('Source name (required if multiple sources have pages with same path/id)'),
});

// Full schema with refinement (used for validation)
export const ReadToolParams = ReadToolParamsBase.refine((params) => params.path || params.id, {
	message: 'Either path or id must be provided',
	path: ['path'],
});

export type SearchToolParams = z.infer<typeof SearchToolParams>;
export type ReadToolParams = z.infer<typeof ReadToolParams>;

// JSON Schema exports for MCP tool registration
// Type assertion needed due to Zod 4 incompatibility with zod-to-json-schema types
// biome-ignore lint/suspicious/noExplicitAny: zod-to-json-schema not yet compatible with Zod 4 types
export const SearchToolParamsJsonSchema = zodToJsonSchema(SearchToolParams as any, {
	$refStrategy: 'none',
});

// Generate base schema and add anyOf constraint to express "path or id required"
// biome-ignore lint/suspicious/noExplicitAny: zod-to-json-schema not yet compatible with Zod 4 types
const readToolParamsBaseSchema = zodToJsonSchema(ReadToolParamsBase as any, {
	$refStrategy: 'none',
});

export const ReadToolParamsJsonSchema = {
	...readToolParamsBaseSchema,
	anyOf: [{ required: ['path'] }, { required: ['id'] }],
} as typeof readToolParamsBaseSchema;
