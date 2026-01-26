import type { SearchDocument, SearchResult } from '../search/types.js';

// MCP API uses snake_case for external consistency
export interface SearchToolInput {
	query: string;
	limit?: number;
	source?: string;
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
	include_related?: boolean;
}

export interface SearchResultWithSource extends SearchResult {
	source: string;
}

export interface SearchToolOutput {
	results: SearchResultWithSource[];
	total: number;
}

export interface ReadToolInput {
	path?: string;
	id?: string;
	source?: string;
}

export interface ReadToolOutput extends SearchDocument {
	source: string;
}
