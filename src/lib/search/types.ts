export interface SearchDocument {
	id: string;
	title: string;
	content: string;
	path: string;
	labels?: string[];
	author_email?: string;
	created_at?: number;
	updated_at?: number;
	child_count?: number;
}

export interface SearchOptions {
	query: string;
	limit?: number;
	labels?: string[];
	author?: string;
	createdAfter?: string;
	createdBefore?: string;
	createdWithin?: string;
	updatedAfter?: string;
	updatedBefore?: string;
	updatedWithin?: string;
	stale?: string;
	sort?: 'created_at' | '-created_at' | 'updated_at' | '-updated_at';
}

export interface SearchResult {
	id: string;
	title: string;
	path: string;
	snippet?: string;
	labels?: string[];
	author_email?: string;
	created_at?: number;
	updated_at?: number;
	child_count?: number;
}

export interface SearchResponse {
	results: SearchResult[];
	total: number;
	query: string;
}

export interface IndexStatus {
	status: 'ok' | 'error';
	message: string;
	indexName?: string;
	documentCount?: number;
}

export interface IndexResult {
	indexed: number;
	total: number;
	indexName: string;
}
