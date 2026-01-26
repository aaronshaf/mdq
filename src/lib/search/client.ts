import {
	MeiliSearch,
	type SearchResponse as MeiliSearchResponse,
	type SearchParams,
} from 'meilisearch';
import { buildDateFilters, filtersToMeilisearchString } from './date-utils.js';
import type {
	Atom,
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

		// Fetch atoms for each result in parallel
		const atomsPromises = response.hits.map((hit) =>
			this.getAtomsForDocument(indexName, hit.id).catch(() => []),
		);
		const atomsResults = await Promise.all(atomsPromises);

		const results: SearchResult[] = response.hits.map((hit, index) => ({
			id: hit.id,
			title: hit.title,
			path: hit.path,
			snippet: hit._formatted?.content?.slice(0, DEFAULT_SNIPPET_LENGTH),
			labels: hit.labels,
			author_email: hit.author_email,
			created_at: hit.created_at,
			updated_at: hit.updated_at,
			child_count: hit.child_count,
			summary: hit.summary,
			related_ids: hit.related_ids,
			atoms: atomsResults[index]!.length > 0 ? atomsResults[index] : undefined,
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
			searchableAttributes: ['title', 'content', 'summary'],
			filterableAttributes: [
				'labels',
				'author_email',
				'created_at',
				'updated_at',
				'smart_indexed_at',
				'pass_level',
			],
			sortableAttributes: ['created_at', 'updated_at', 'smart_indexed_at'],
		});
		await this.client.waitForTask(settingsTask.taskUid);
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

	async ensureAtomsIndex(indexName: string): Promise<void> {
		const atomsIndexName = `${indexName}-atoms`;

		// Check if index already exists
		try {
			await this.client.getIndex(atomsIndexName);
			// Index exists, nothing to do
			return;
		} catch {
			// Index doesn't exist, create it
		}

		const task = await this.client.createIndex(atomsIndexName, { primaryKey: 'id' });
		await this.client.waitForTask(task.taskUid);

		const index = this.client.index(atomsIndexName);
		const settingsTask = await index.updateSettings({
			searchableAttributes: ['content'],
			filterableAttributes: ['doc_id', 'created_at'],
			sortableAttributes: ['created_at'],
		});
		await this.client.waitForTask(settingsTask.taskUid);
	}

	async recreateAtomsIndex(indexName: string): Promise<void> {
		const atomsIndexName = `${indexName}-atoms`;

		try {
			await this.client.deleteIndex(atomsIndexName);
		} catch {
			// Index might not exist, that's okay
		}

		const task = await this.client.createIndex(atomsIndexName, { primaryKey: 'id' });
		await this.client.waitForTask(task.taskUid);

		const index = this.client.index(atomsIndexName);
		const settingsTask = await index.updateSettings({
			searchableAttributes: ['content'],
			filterableAttributes: ['doc_id', 'created_at'],
			sortableAttributes: ['created_at'],
		});
		await this.client.waitForTask(settingsTask.taskUid);
	}

	/** @deprecated Use ensureAtomsIndex for non-destructive or recreateAtomsIndex for forced recreation */
	async createAtomsIndex(indexName: string): Promise<void> {
		return this.recreateAtomsIndex(indexName);
	}

	async addAtoms(indexName: string, atoms: Atom[]): Promise<void> {
		const atomsIndexName = `${indexName}-atoms`;
		const index = this.client.index(atomsIndexName);
		const task = await index.addDocuments(atoms);
		const result = await this.client.waitForTask(task.taskUid);

		// Check if task failed
		if (result.status === 'failed') {
			throw new Error(`Failed to add atoms: ${result.error?.message || 'Unknown error'}`);
		}
	}

	async searchAtoms(
		indexName: string,
		query: string,
		limit = 10,
	): Promise<Array<Atom & { _formatted?: { content?: string } }>> {
		const atomsIndexName = `${indexName}-atoms`;
		const index = this.client.index<Atom>(atomsIndexName);

		const response = await index.search(query, {
			limit,
			attributesToHighlight: ['content'],
			highlightPreTag: '',
			highlightPostTag: '',
		});

		return response.hits;
	}

	async deleteAtomsForDocument(indexName: string, docId: string): Promise<void> {
		const atomsIndexName = `${indexName}-atoms`;
		const index = this.client.index<Atom>(atomsIndexName);

		try {
			const task = await index.deleteDocuments({
				filter: `doc_id = "${escapeFilterValue(docId)}"`,
			});
			await this.client.waitForTask(task.taskUid);
		} catch {
			// Index or documents might not exist
		}
	}

	async getAtomsForDocument(indexName: string, docId: string): Promise<string[]> {
		const atomsIndexName = `${indexName}-atoms`;
		const index = this.client.index<Atom>(atomsIndexName);

		try {
			const response = await index.search('', {
				filter: `doc_id = "${escapeFilterValue(docId)}"`,
				limit: 100, // Get up to 100 atoms per document
			});

			return response.hits.map((atom) => atom.content);
		} catch {
			// Index might not exist or no atoms for this document
			return [];
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
