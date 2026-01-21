import type { SearchDocument, SearchResult } from '../search/types.js';

// MCP API uses snake_case for external consistency
export interface SearchToolInput {
	query: string;
	limit?: number;
	labels?: string[];
	author?: string;
	created_after?: string;
	created_before?: string;
	created_within?: string;
	updated_after?: string;
	updated_before?: string;
	updated_within?: string;
	stale?: string;
	sort?: 'created_at' | '-created_at' | 'updated_at' | '-updated_at';
}

export interface SearchToolOutput {
	results: SearchResult[];
	total: number;
}

export interface ReadToolInput {
	path?: string;
	id?: string;
}

export type ReadToolOutput = SearchDocument;
