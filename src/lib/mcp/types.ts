import type { SearchResult } from '../search/types.js';

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

export interface ReadToolOutput {
	id: string;
	title: string;
	content: string;
	path: string;
	source: string;
	created_at?: number; // From filesystem
	updated_at?: number; // From filesystem
	frontmatter: Record<string, unknown>; // All front matter fields
}
