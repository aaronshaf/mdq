import {
	MeiliSearch,
	type SearchResponse as MeiliSearchResponse,
	type SearchParams,
} from 'meilisearch';
import { buildDateFilters, filtersToMeilisearchString } from './date-utils.js';
import type {
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
		const index = this.client.index(indexName);

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

		const searchParams: SearchParams = {
			limit: options.limit ?? DEFAULT_LIMIT,
			attributesToHighlight: ['content'],
			highlightPreTag: '',
			highlightPostTag: '',
			attributesToCrop: ['content'],
			cropLength: DEFAULT_SNIPPET_LENGTH,
		};

		if (filterParts.length > 0) {
			searchParams.filter = filterParts.join(' AND ');
		}

		if (options.sort) {
			const sortField = options.sort.startsWith('-') ? options.sort.slice(1) : options.sort;
			const sortOrder = options.sort.startsWith('-') ? 'desc' : 'asc';
			searchParams.sort = [`${sortField}:${sortOrder}`];
		}

		const response: MeiliSearchResponse<SearchDocument> = await index.search(
			options.query,
			searchParams,
		);

		const results: SearchResult[] = response.hits.map((hit) => ({
			id: hit.id,
			title: hit.title,
			path: hit.path,
			snippet: hit._formatted?.content?.slice(0, DEFAULT_SNIPPET_LENGTH),
			labels: hit.labels,
			author_email: hit.author_email,
			created_at: hit.created_at,
			updated_at: hit.updated_at,
		}));

		return {
			results,
			total: response.estimatedTotalHits ?? results.length,
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
		const settingsTask = await index.updateSettings({
			searchableAttributes: ['title', 'content'],
			filterableAttributes: ['labels', 'author_email', 'created_at', 'updated_at'],
			sortableAttributes: ['created_at', 'updated_at'],
		});
		await this.client.waitForTask(settingsTask.taskUid);
	}

	async addDocuments(indexName: string, documents: SearchDocument[]): Promise<void> {
		const index = this.client.index(indexName);
		const task = await index.addDocuments(documents);
		await this.client.waitForTask(task.taskUid);
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
