import chalk from 'chalk';
import { formatError } from '../errors.js';
import { type LLMClient, createLLMClient, loadEmbeddingConfig } from '../llm/index.js';
import { type Logger, createLogger } from '../logger.js';
import { chunkText } from './chunker.js';
import { type SearchClient, createSearchClient } from './client.js';
import { deriveIndexName } from './indexer.js';
import type { ChunkDocument, EmbedResult, SearchDocument } from './types.js';

// Named constants
const EMBED_BATCH_SIZE = 20; // Chunks to embed in a single API call

export interface EmbedOptions {
	reset?: boolean;
	dryRun?: boolean;
	verbose?: boolean;
	batchSize?: number;
	timeLimitMinutes?: number;
}

export class Embedder {
	private searchClient: SearchClient;
	private llmClient: LLMClient;
	private logger: Logger;

	constructor(options?: {
		searchClient?: SearchClient;
		llmClient?: LLMClient;
		verbose?: boolean;
	}) {
		this.searchClient = options?.searchClient ?? createSearchClient();
		this.llmClient = options?.llmClient ?? createLLMClient();
		this.logger = createLogger(options?.verbose ?? false);
	}

	async embed(dirPath: string, options: EmbedOptions): Promise<EmbedResult> {
		const indexName = deriveIndexName(dirPath);
		const chunksIndexName = `${indexName}-chunks`;

		const startTime = Date.now();
		const timeLimitMs = options.timeLimitMinutes
			? options.timeLimitMinutes * 60 * 1000
			: Number.POSITIVE_INFINITY;
		const maxDocs = options.batchSize ?? Number.POSITIVE_INFINITY;

		// Delete chunks index if reset is requested
		if (options.reset) {
			this.logger.info('Reset mode: deleting existing chunks index');
			await this.searchClient.deleteIndex(chunksIndexName);

			// Clear embedded_at on all documents so interrupted resets can resume
			this.logger.info('Reset mode: clearing embedding metadata');
			const docsToReset = await this.searchClient.getAllDocuments(indexName);
			const resetUpdates = docsToReset
				.filter((doc) => doc.embedded_at !== undefined)
				.map((doc) => ({
					id: doc.id,
					embedded_at: null as unknown as undefined,
					chunk_count: null as unknown as undefined,
				}));
			if (resetUpdates.length > 0) {
				await this.searchClient.updateDocuments(indexName, resetUpdates);
			}
		}

		// Ensure chunks index exists with embedder configured
		await this.ensureChunksIndex(chunksIndexName);

		// Get all documents
		const allDocs = await this.searchClient.getAllDocuments(indexName);

		// Determine which documents need embedding
		let docsToProcess: SearchDocument[];
		if (options.reset) {
			docsToProcess = allDocs;
			this.logger.info(`Reset mode: will process all ${allDocs.length} documents`);
		} else {
			docsToProcess = allDocs.filter((doc) => {
				// Needs embedding if never embedded or content changed since last embed
				if (!doc.embedded_at) return true;
				if (doc.updated_at && doc.updated_at > doc.embedded_at) return true;
				return false;
			});
			this.logger.info(
				`Found ${docsToProcess.length} documents needing embedding (${allDocs.length} total)`,
			);
		}

		if (docsToProcess.length === 0) {
			this.logger.success('All documents are already embedded.');
			return {
				documentsProcessed: 0,
				documentsSkipped: allDocs.length,
				documentsFailed: 0,
				chunksCreated: 0,
				durationMs: Date.now() - startTime,
				indexName,
				chunksIndexName,
			};
		}

		if (options.dryRun) {
			this.logger.info(`Dry run: would process ${docsToProcess.length} documents`);
			return {
				documentsProcessed: 0,
				documentsSkipped: allDocs.length - docsToProcess.length,
				documentsFailed: 0,
				chunksCreated: 0,
				durationMs: Date.now() - startTime,
				indexName,
				chunksIndexName,
			};
		}

		let documentsProcessed = 0;
		let documentsSkipped = 0;
		let documentsFailed = 0;
		let totalChunksCreated = 0;

		for (const doc of docsToProcess) {
			// Check limits
			if (documentsProcessed >= maxDocs) {
				this.logger.warning(`Batch size limit reached (${maxDocs} documents)`);
				break;
			}

			const elapsed = Date.now() - startTime;
			if (elapsed >= timeLimitMs) {
				this.logger.warning(`Time limit reached (${options.timeLimitMinutes} minutes)`);
				break;
			}

			const docStart = Date.now();

			try {
				// Create chunks for this document
				const chunks = chunkText({ title: doc.title, content: doc.content });

				if (chunks.length === 0) {
					// Mark as processed with 0 chunks to avoid reprocessing
					await this.searchClient.updateDocuments(indexName, [
						{
							id: doc.id,
							embedded_at: Date.now(),
							chunk_count: 0,
						},
					]);
					documentsSkipped++;
					continue;
				}

				// Delete existing chunks for this document
				await this.searchClient.deleteChunksForParent(chunksIndexName, doc.id);

				// Embed all chunks in batches
				const chunkDocuments: ChunkDocument[] = [];

				for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
					const batchChunks = chunks.slice(i, i + EMBED_BATCH_SIZE);
					const textsToEmbed = batchChunks.map((c) => c.embeddingContent);
					const embeddings = await this.llmClient.embedBatch(textsToEmbed);

					for (let j = 0; j < batchChunks.length; j++) {
						const chunk = batchChunks[j]!;
						const embedding = embeddings[j]!;

						chunkDocuments.push({
							id: `${doc.id}_chunk_${chunk.index}`,
							parent_id: doc.id,
							parent_title: doc.title,
							parent_path: doc.path,
							chunk_index: chunk.index,
							content: chunk.content,
							labels: doc.labels,
							author_email: doc.author_email,
							created_at: doc.created_at,
							updated_at: doc.updated_at,
							_vectors: { default: embedding },
						});
					}
				}

				// Add chunks to index
				await this.searchClient.addChunks(chunksIndexName, chunkDocuments);

				// Update document with embedding metadata
				await this.searchClient.updateDocuments(indexName, [
					{
						id: doc.id,
						embedded_at: Date.now(),
						chunk_count: chunks.length,
					},
				]);

				const docMs = Date.now() - docStart;
				documentsProcessed++;
				totalChunksCreated += chunks.length;

				this.logger.documentProgress(
					documentsProcessed,
					docsToProcess.length,
					doc.path,
					`${chalk.green('✓')} ${chunks.length} chunk${chunks.length !== 1 ? 's' : ''} ${chalk.dim(`(${this.formatDuration(docMs)})`)}`,
				);
			} catch (error) {
				documentsFailed++;
				this.logger.error(`Error embedding ${doc.title}: ${formatError(error)}`);
			}
		}

		const durationMs = Date.now() - startTime;
		const totalSeconds = Math.round(durationMs / 1000);
		this.logger.success(
			`Processed ${documentsProcessed} document(s), created ${totalChunksCreated} chunks in ${totalSeconds}s`,
		);
		if (documentsFailed > 0) {
			this.logger.warning(`${documentsFailed} document(s) failed`);
		}

		return {
			documentsProcessed,
			documentsSkipped,
			documentsFailed,
			chunksCreated: totalChunksCreated,
			durationMs,
			indexName,
			chunksIndexName,
		};
	}

	private async ensureChunksIndex(chunksIndexName: string): Promise<void> {
		const embeddingConfig = loadEmbeddingConfig();

		const exists = await this.searchClient.indexExists(chunksIndexName);
		if (!exists) {
			this.logger.info(`Creating chunks index: ${chunksIndexName}`);
			await this.searchClient.createChunksIndex(chunksIndexName, embeddingConfig.dimensions);
			return;
		}

		// Index exists - validate dimensions match
		const existingDimensions = await this.searchClient.getEmbedderDimensions(chunksIndexName);
		if (existingDimensions !== null && existingDimensions !== embeddingConfig.dimensions) {
			throw new Error(
				`Embedding dimensions mismatch: index has ${existingDimensions} but config specifies ${embeddingConfig.dimensions}. Use --reset to rebuild the chunks index with the new dimensions.`,
			);
		}

		// Try to configure embedder (may fail if already configured)
		try {
			await this.searchClient.configureChunksEmbedder(chunksIndexName, embeddingConfig.dimensions);
			this.logger.info(`Configured embedder with ${embeddingConfig.dimensions} dimensions`);
		} catch (error) {
			const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : null;

			const isEmbedderConfigError =
				errorCode === 'invalid_settings_embedders' || errorCode === 'immutable_embedder_setting';

			if (isEmbedderConfigError) {
				this.logger.info('Embedder already configured (skipping)');
			} else {
				throw error;
			}
		}
	}

	private formatDuration(ms: number): string {
		if (ms < 1000) {
			return `${ms}ms`;
		}
		const seconds = (ms / 1000).toFixed(1);
		return `${seconds}s`;
	}

	async checkPrerequisites(dirPath: string): Promise<{ ok: boolean; message: string }> {
		// Check Meilisearch
		const meiliHealth = await this.searchClient.checkHealth();
		if (!meiliHealth.healthy) {
			return { ok: false, message: meiliHealth.message };
		}

		// Check embedding service
		const embeddingHealth = await this.llmClient.checkEmbeddingHealth();
		if (!embeddingHealth.healthy) {
			return { ok: false, message: embeddingHealth.message };
		}

		// Check index exists
		const indexName = deriveIndexName(dirPath);
		const status = await this.searchClient.getStatus(indexName);
		if (status.documentCount === undefined || status.documentCount === 0) {
			return {
				ok: false,
				message: `Index "${indexName}" is empty or does not exist. Run "mdq index --path ${dirPath}" first.`,
			};
		}

		return { ok: true, message: 'All prerequisites met' };
	}
}

export function createEmbedder(options?: {
	searchClient?: SearchClient;
	llmClient?: LLMClient;
	verbose?: boolean;
}): Embedder {
	return new Embedder(options);
}

// Legacy exports for backwards compatibility during transition
export { Embedder as SmartIndexer };
export { createEmbedder as createSmartIndexer };
export type { EmbedOptions as SmartIndexOptions };
export type { EmbedResult as SmartIndexResult };
