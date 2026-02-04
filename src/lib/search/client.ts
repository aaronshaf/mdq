import { MeiliSearch, type SearchParams } from 'meilisearch';
import { buildDateFilters, filtersToMeilisearchString } from './date-utils.js';
import type {
	ChunkDocument,
	IndexStatus,
	SearchDocument,
	SearchOptions,
	SearchResponse,
	SearchResult,
} from './types.js';

const DEFAULT_SNIPPET_LENGTH = 200;
const DEFAULT_LIMIT = 10;

function escapeFilterValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface SearchClientConfig {
	host: string;
	apiKey?: string;
}

export class SearchClient {
	private client: MeiliSearch;

	constructor(config: SearchClientConfig) {
		this.client = new MeiliSearch({
			host: config.host,
			apiKey: config.apiKey,
		});
	}

	async search(indexName: string, options: SearchOptions): Promise<SearchResponse> {
		const chunksIndexName = `${indexName}-chunks`;
		const limit = options.limit ?? DEFAULT_LIMIT;

		const filterParts: string[] = [];

		// Label filters (OR logic)
		if (options.labels && options.labels.length > 0) {
			const labelFilter = options.labels
				.map((l) => `labels = "${escapeFilterValue(l)}"`)
				.join(' OR ');
			filterParts.push(`(${labelFilter})`);
		}

		// Author filter
		if (options.author) {
			filterParts.push(`author_email = "${escapeFilterValue(options.author)}"`);
		}

		// Date filters
		const dateFilters = buildDateFilters({
			createdAfter: options.createdAfter,
			createdBefore: options.createdBefore,
			createdWithin: options.createdWithin,
			updatedAfter: options.updatedAfter,
			updatedBefore: options.updatedBefore,
			updatedWithin: options.updatedWithin,
			stale: options.stale,
		});

		if (dateFilters.length > 0) {
			filterParts.push(filtersToMeilisearchString(dateFilters));
		}

		const filterString = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;

		// Keyword search on documents index
		const docIndex = this.client.index<SearchDocument>(indexName);
		const docSearchParams: SearchParams = {
			limit: limit * 2, // Get more for merging
			attributesToHighlight: ['content'],
			highlightPreTag: '',
			highlightPostTag: '',
			attributesToCrop: ['content'],
			cropLength: DEFAULT_SNIPPET_LENGTH,
		};

		if (filterString) {
			docSearchParams.filter = filterString;
		}

		if (options.sort) {
			const sortField = options.sort.startsWith('-') ? options.sort.slice(1) : options.sort;
			const sortOrder = options.sort.startsWith('-') ? 'desc' : 'asc';
			docSearchParams.sort = [`${sortField}:${sortOrder}`];
		}

		const keywordResponse = await docIndex.search(options.query, docSearchParams);

		// Try semantic search on chunks index (skip existence check, handle errors)
		let chunkResults: Array<ChunkDocument & { _score?: number }> = [];
		try {
			chunkResults = await this.searchChunks(chunksIndexName, options.query, {
				limit: limit * 3, // Get more chunks for deduplication
				filter: filterString,
			});
		} catch {
			// Silently fall back to keyword-only results
			// This can happen if chunks index doesn't exist, embedder isn't configured, etc.
		}

		// Build results map from keyword search
		const resultsMap = new Map<
			string,
			{ result: SearchResult; keywordRank: number; semanticRank: number }
		>();

		keywordResponse.hits.forEach((hit, idx) => {
			resultsMap.set(hit.id, {
				result: {
					id: hit.id,
					title: hit.title,
					path: hit.path,
					snippet: hit._formatted?.content?.slice(0, DEFAULT_SNIPPET_LENGTH),
					labels: hit.labels,
					author_email: hit.author_email,
					created_at: hit.created_at,
					updated_at: hit.updated_at,
					child_count: hit.child_count,
					reference: hit.reference,
					curatorNote: hit.curatorNote,
				},
				keywordRank: idx + 1,
				semanticRank: 0, // Will be updated if found in chunks
			});
		});

		// Deduplicate chunks by parent_id and merge with keyword results
		const bestChunkByParent = new Map<string, ChunkDocument & { _score?: number }>();
		for (const chunk of chunkResults) {
			const existing = bestChunkByParent.get(chunk.parent_id);
			if (!existing || (chunk._score ?? 0) > (existing._score ?? 0)) {
				bestChunkByParent.set(chunk.parent_id, chunk);
			}
		}

		// Add semantic ranks from chunks
		let semanticRank = 1;
		for (const [parentId, chunk] of bestChunkByParent) {
			const existing = resultsMap.get(parentId);
			if (existing) {
				existing.semanticRank = semanticRank;
				// Use chunk content as snippet if it's better
				if (chunk.content && chunk.content.length > 0) {
					existing.result.snippet = chunk.content.slice(0, DEFAULT_SNIPPET_LENGTH);
				}
			} else {
				// Document found only via semantic search
				resultsMap.set(parentId, {
					result: {
						id: parentId,
						title: chunk.parent_title,
						path: chunk.parent_path,
						snippet: chunk.content?.slice(0, DEFAULT_SNIPPET_LENGTH),
						labels: chunk.labels,
						author_email: chunk.author_email,
						created_at: chunk.created_at,
						updated_at: chunk.updated_at,
						curatorNote: chunk.curatorNote,
					},
					keywordRank: 0,
					semanticRank,
				});
			}
			semanticRank++;
		}

		// Calculate RRF scores and sort
		const k = 60; // RRF constant
		const scored = Array.from(resultsMap.values()).map(({ result, keywordRank, semanticRank }) => {
			// RRF: 1/(k+rank) for each list, sum them
			const keywordScore = keywordRank > 0 ? 1 / (k + keywordRank) : 0;
			const semanticScore = semanticRank > 0 ? 1 / (k + semanticRank) : 0;
			const rrfScore = keywordScore + semanticScore;
			return { result, rrfScore };
		});

		scored.sort((a, b) => b.rrfScore - a.rrfScore);

		const results = scored.slice(0, limit).map(({ result }) => result);

		return {
			results,
			total: keywordResponse.estimatedTotalHits ?? results.length,
			query: options.query,
		};
	}

	async getDocumentById(indexName: string, id: string): Promise<SearchDocument | null> {
		const index = this.client.index<SearchDocument>(indexName);

		try {
			const doc = await index.getDocument(id);
			return doc as SearchDocument;
		} catch (error) {
			// Meilisearch returns a MeiliSearchApiError with code for not found
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'document_not_found'
			) {
				return null;
			}
			// Re-throw unexpected errors
			throw error;
		}
	}

	async checkHealth(): Promise<{ healthy: boolean; message: string }> {
		try {
			await this.client.health();
			return { healthy: true, message: 'Meilisearch is running' };
		} catch (error) {
			return {
				healthy: false,
				message: `Cannot connect to Meilisearch: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}

	async getStatus(indexName: string): Promise<IndexStatus> {
		try {
			await this.client.health();

			try {
				const index = this.client.index(indexName);
				const stats = await index.getStats();

				return {
					status: 'ok',
					message: 'Connected to Meilisearch',
					indexName,
					documentCount: stats.numberOfDocuments,
				};
			} catch {
				return {
					status: 'ok',
					message: 'Connected to Meilisearch (index not found)',
					indexName,
				};
			}
		} catch (error) {
			return {
				status: 'error',
				message: `Cannot connect to Meilisearch: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}

	async deleteIndex(indexName: string): Promise<void> {
		try {
			const task = await this.client.deleteIndex(indexName);
			await this.client.waitForTask(task.taskUid);
		} catch {
			// Index might not exist, that's okay
		}
	}

	async createIndex(indexName: string): Promise<void> {
		const task = await this.client.createIndex(indexName, { primaryKey: 'id' });
		await this.client.waitForTask(task.taskUid);

		// Configure index settings
		const index = this.client.index(indexName);

		const settings: Record<string, unknown> = {
			searchableAttributes: ['title', 'content'],
			filterableAttributes: ['labels', 'author_email', 'created_at', 'updated_at', 'embedded_at'],
			sortableAttributes: ['created_at', 'updated_at', 'embedded_at'],
		};

		const settingsTask = await index.updateSettings(settings);
		await this.client.waitForTask(settingsTask.taskUid);
	}

	async createChunksIndex(indexName: string, embeddingDimensions: number): Promise<void> {
		const task = await this.client.createIndex(indexName, { primaryKey: 'id' });
		await this.client.waitForTask(task.taskUid);

		const index = this.client.index(indexName);

		const settings: Record<string, unknown> = {
			searchableAttributes: ['content', 'parent_title'],
			filterableAttributes: [
				'parent_id',
				'parent_path',
				'labels',
				'author_email',
				'created_at',
				'updated_at',
			],
			sortableAttributes: ['chunk_index', 'created_at', 'updated_at'],
			embedders: {
				default: {
					source: 'userProvided',
					dimensions: embeddingDimensions,
				},
			},
		};

		const settingsTask = await index.updateSettings(settings);
		await this.client.waitForTask(settingsTask.taskUid);
	}

	async configureChunksEmbedder(chunksIndexName: string, dimensions: number): Promise<void> {
		const index = this.client.index(chunksIndexName);
		const settingsTask = await index.updateSettings({
			embedders: {
				default: {
					source: 'userProvided',
					dimensions,
				},
			},
		});
		await this.client.waitForTask(settingsTask.taskUid);
	}

	async getEmbedderDimensions(indexName: string): Promise<number | null> {
		try {
			const index = this.client.index(indexName);
			const settings = await index.getSettings();
			const embedders = settings.embedders as Record<string, { dimensions?: number }> | undefined;
			return embedders?.default?.dimensions ?? null;
		} catch {
			return null;
		}
	}

	async addDocuments(indexName: string, documents: SearchDocument[]): Promise<void> {
		const index = this.client.index(indexName);
		const task = await index.addDocuments(documents);
		await this.client.waitForTask(task.taskUid);
	}

	async updateDocuments(indexName: string, documents: Partial<SearchDocument>[]): Promise<void> {
		const index = this.client.index(indexName);
		const task = await index.updateDocuments(documents);
		await this.client.waitForTask(task.taskUid);
	}

	async getAllDocuments(indexName: string, batchSize = 1000): Promise<SearchDocument[]> {
		const index = this.client.index<SearchDocument>(indexName);
		const allDocuments: SearchDocument[] = [];
		let offset = 0;

		// Paginate through all documents
		while (true) {
			const result = await index.getDocuments({ limit: batchSize, offset });
			allDocuments.push(...result.results);

			if (result.results.length < batchSize) {
				// No more documents
				break;
			}
			offset += batchSize;
		}

		return allDocuments;
	}

	async getDocumentsWithFilter(
		indexName: string,
		filter: string,
		batchSize = 1000,
	): Promise<SearchDocument[]> {
		const index = this.client.index<SearchDocument>(indexName);
		const allDocuments: SearchDocument[] = [];
		let offset = 0;

		// Paginate through all matching documents
		while (true) {
			const result = await index.getDocuments({ limit: batchSize, offset, filter });
			allDocuments.push(...result.results);

			if (result.results.length < batchSize) {
				break;
			}
			offset += batchSize;
		}

		return allDocuments;
	}

	// Chunk-related methods

	async addChunks(chunksIndexName: string, chunks: ChunkDocument[]): Promise<void> {
		if (chunks.length === 0) return;
		const index = this.client.index(chunksIndexName);
		const task = await index.addDocuments(chunks);
		await this.client.waitForTask(task.taskUid);
	}

	async deleteChunksForParent(chunksIndexName: string, parentId: string): Promise<void> {
		const index = this.client.index(chunksIndexName);
		try {
			const task = await index.deleteDocuments({
				filter: `parent_id = "${parentId.replace(/"/g, '\\"')}"`,
			});
			await this.client.waitForTask(task.taskUid);
		} catch {
			// Index might not exist or no chunks to delete
		}
	}

	async searchChunks(
		chunksIndexName: string,
		query: string,
		options: {
			limit?: number;
			filter?: string;
		} = {},
	): Promise<Array<ChunkDocument & { _score?: number }>> {
		const index = this.client.index<ChunkDocument>(chunksIndexName);

		try {
			const response = await index.search(query, {
				limit: options.limit ?? 50,
				filter: options.filter,
				hybrid: {
					embedder: 'default',
					semanticRatio: 0.8, // Favor semantic for chunk search
				},
			});

			return response.hits.map((hit, idx) => ({
				...hit,
				_score: response.hits.length - idx, // Higher is better
			}));
		} catch (error) {
			// Only fall back for embedder-not-configured errors
			const isEmbedderError =
				error &&
				typeof error === 'object' &&
				(('code' in error &&
					(error.code === 'invalid_search_hybrid' ||
						error.code === 'invalid_settings_embedders')) ||
					('message' in error &&
						typeof error.message === 'string' &&
						error.message.includes('embedder')));
			if (!isEmbedderError) {
				throw error;
			}
			// Fall back to keyword search
			const response = await index.search(query, {
				limit: options.limit ?? 50,
				filter: options.filter,
			});
			return response.hits.map((hit, idx) => ({
				...hit,
				_score: response.hits.length - idx,
			}));
		}
	}

	async indexExists(indexName: string): Promise<boolean> {
		try {
			await this.client.index(indexName).getStats();
			return true;
		} catch {
			return false;
		}
	}

	get meiliClient(): MeiliSearch {
		return this.client;
	}
}

export function createSearchClient(config?: Partial<SearchClientConfig>): SearchClient {
	return new SearchClient({
		host: config?.host ?? process.env.MEILISEARCH_HOST ?? 'http://localhost:7700',
		apiKey: config?.apiKey ?? process.env.MEILISEARCH_API_KEY,
	});
}
