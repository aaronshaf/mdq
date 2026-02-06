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
	reference?: string; // Chicago-style citation for the source
	curatorNote?: string; // Curator's commentary about this document
	// Embedding fields
	embedded_at?: number;
	chunk_count?: number;
}

export interface ChunkDocument {
	id: string; // "{parent_id}_chunk_{index}"
	parent_id: string; // Reference to parent document
	parent_title: string; // Denormalized for display
	parent_path: string; // Denormalized for filtering
	chunk_index: number; // Position in parent (0-based)
	content: string; // Chunk text
	labels?: string[];
	author_email?: string;
	created_at?: number;
	updated_at?: number;
	curatorNote?: string; // Denormalized from parent
	_vectors: { default: number[] };
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
	reference?: string; // Chicago-style citation for the source
	curatorNote?: string; // Curator's commentary about this document
}

export interface SearchResponse {
	results: SearchResult[];
	total: number;
	query: string;
	warnings?: Array<{ source: string; message: string }>;
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
	errors?: Array<{ file: string; error: string }>;
}

export interface EmbedResult {
	documentsProcessed: number;
	documentsSkipped: number;
	documentsFailed: number;
	chunksCreated: number;
	durationMs: number;
	indexName: string;
	chunksIndexName: string;
}
