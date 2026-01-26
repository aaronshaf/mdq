import chalk from 'chalk';
import { formatError } from '../errors.js';
import {
	type LLMClient,
	type RelationshipCandidate,
	buildAtomsPrompt,
	buildRelationshipsPrompt,
	buildSummaryPrompt,
	createLLMClient,
	parseJsonArray,
} from '../llm/index.js';
import { type Logger, createLogger } from '../logger.js';
import { createAtoms } from './atoms.js';
import { type SearchClient, createSearchClient } from './client.js';
import { deriveIndexName } from './indexer.js';
import type { SearchDocument, SmartIndexResult } from './types.js';

// Named constants
const MAX_RELATIONSHIP_CANDIDATES = 20;
const DEFAULT_CONCURRENCY = 1;
const MAX_RELATED_IDS_PER_DOC = 50;

// Pass enum for type safety
export enum Pass {
	SUMMARY = 1,
	ATOMS = 2,
	RELATIONSHIPS = 3,
}

export interface SmartIndexOptions {
	pass: Pass | 'all';
	reset?: boolean;
	dryRun?: boolean;
	only?: boolean;
	verbose?: boolean;
	concurrency?: number;
}

interface PassResult {
	processed: number;
	skipped: number;
	total: number;
	errors: number;
	atomsCreated?: number;
}

// Simple semaphore for concurrency control
class Semaphore {
	private permits: number;
	private waiting: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = permits;
	}

	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--;
			return;
		}
		return new Promise((resolve) => {
			this.waiting.push(resolve);
		});
	}

	release(): void {
		if (this.waiting.length > 0) {
			const next = this.waiting.shift()!;
			next();
		} else {
			this.permits++;
		}
	}
}

export class SmartIndexer {
	private searchClient: SearchClient;
	private llmClient: LLMClient;
	private logger: Logger;
	private concurrency: number;

	constructor(options?: {
		searchClient?: SearchClient;
		llmClient?: LLMClient;
		verbose?: boolean;
		concurrency?: number;
	}) {
		this.searchClient = options?.searchClient ?? createSearchClient();
		this.llmClient = options?.llmClient ?? createLLMClient();
		this.logger = createLogger(options?.verbose ?? false);
		this.concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
	}

	async smartIndex(dirPath: string, options: SmartIndexOptions): Promise<SmartIndexResult[]> {
		const indexName = deriveIndexName(dirPath);
		const results: SmartIndexResult[] = [];

		// Determine which passes to run
		const maxPass = options.pass === 'all' ? Pass.RELATIONSHIPS : options.pass;
		const startPass = options.only ? maxPass : Pass.SUMMARY;

		// Use options concurrency or instance default
		const concurrency = options.concurrency ?? this.concurrency;

		for (let pass = startPass; pass <= maxPass; pass++) {
			this.logger.info(`\nStarting pass ${pass} (${this.getPassName(pass)})...`);

			// Get documents that need processing for this pass
			const documents = await this.getDocumentsForPass(indexName, pass, options.reset ?? false);
			const passResult = await this.runPass(indexName, pass, options, documents, concurrency);

			results.push({
				pass,
				processed: passResult.processed,
				total: passResult.total,
				indexName,
				...(pass === Pass.ATOMS && {
					atomsIndexName: `${indexName}-atoms`,
					atomsCreated: passResult.atomsCreated ?? 0,
				}),
			});

			this.logger.success(
				`Pass ${pass} complete: processed ${passResult.processed}/${passResult.total} documents`,
			);
			if (passResult.skipped > 0) {
				this.logger.info(`  ${passResult.skipped} skipped`);
			}
			if (passResult.errors > 0) {
				this.logger.warning(`  ${passResult.errors} errors`);
			}
			if (passResult.atomsCreated !== undefined) {
				this.logger.info(`  ${passResult.atomsCreated} atoms created`);
			}
		}

		return results;
	}

	async smartIndexAuto(
		dirPath: string,
		options: {
			batchSize?: number;
			timeLimitMinutes?: number;
			reset?: boolean;
			dryRun?: boolean;
			verbose?: boolean;
			concurrency?: number;
		},
	): Promise<SmartIndexResult[]> {
		const indexName = deriveIndexName(dirPath);
		const results: SmartIndexResult[] = [];
		const concurrency = options.concurrency ?? this.concurrency;

		const startTime = Date.now();
		const timeLimitMs = options.timeLimitMinutes
			? options.timeLimitMinutes * 60 * 1000
			: Number.POSITIVE_INFINITY;
		const maxDocs = options.batchSize ?? Number.POSITIVE_INFINITY;

		// Step 1: Get all documents and reset pass_level for modified documents
		const allDocs = await this.searchClient.getAllDocuments(indexName);
		const documentsToReset: SearchDocument[] = [];

		for (const doc of allDocs) {
			if (options.reset) {
				documentsToReset.push(doc);
			} else if (doc.smart_indexed_at && doc.updated_at && doc.updated_at > doc.smart_indexed_at) {
				this.logger.info(`Document modified since last indexing: ${doc.title}`);
				documentsToReset.push(doc);
			}
		}

		// Reset pass_level for force or modified documents
		if (documentsToReset.length > 0) {
			if (options.verbose) {
				this.logger.info(
					`Resetting ${documentsToReset.length} document(s) ${
						options.reset ? '(reset mode)' : '(modified)'
					}`,
				);
			}
			if (!options.dryRun) {
				await this.searchClient.updateDocuments(
					indexName,
					documentsToReset.map((doc) => ({
						id: doc.id,
						pass_level: null as any, // Use null instead of undefined to explicitly clear the field
					})),
				);
				// Update in-memory
				for (const doc of documentsToReset) {
					doc.pass_level = undefined;
				}
			}
		}

		// Step 2: Find incomplete documents (need processing)
		const incomplete = allDocs.filter((d) => !d.pass_level || d.pass_level < Pass.RELATIONSHIPS);

		// Step 3: If everything complete, do refinement pass
		if (incomplete.length === 0) {
			this.logger.info(
				'All documents complete. Running refinement pass (re-evaluating relationships)...',
			);
			const docsToRefine = options.batchSize ? allDocs.slice(0, options.batchSize) : allDocs;

			let refinedCount = 0;
			let refinementErrors = 0;
			for (const doc of docsToRefine) {
				const elapsed = Date.now() - startTime;
				if (elapsed >= timeLimitMs) {
					this.logger.info('Time limit reached, stopping refinement');
					break;
				}

				// Re-run relationships pass with error handling
				if (!options.dryRun) {
					try {
						await this.runPass(
							indexName,
							Pass.RELATIONSHIPS,
							{ reset: false, dryRun: false, verbose: options.verbose },
							[doc],
							concurrency,
						);
						refinedCount++;
					} catch (error) {
						refinementErrors++;
						this.logger.error(
							`Error refining relationships for ${doc.title}: ${formatError(error)}`,
						);
					}
				} else {
					refinedCount++;
				}
			}

			if (refinedCount > 0 || refinementErrors > 0) {
				results.push({
					pass: Pass.RELATIONSHIPS,
					processed: refinedCount,
					total: docsToRefine.length,
					indexName,
				});
				if (refinementErrors > 0) {
					this.logger.warning(`${refinementErrors} error(s) during refinement pass`);
				}
			}

			return results;
		}

		// Step 4: Group incomplete documents by pass_level
		const byLevel = new Map<number, SearchDocument[]>();
		for (const doc of incomplete) {
			const level = doc.pass_level ?? 0;
			if (!byLevel.has(level)) byLevel.set(level, []);
			byLevel.get(level)!.push(doc);
		}

		// Step 5: Process level by level, starting with lowest (depth-first)
		const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
		let totalProcessed = 0;
		let shouldBreak = false;
		const totalToProcess = incomplete.length;

		for (const level of levels) {
			if (shouldBreak) break;

			const docsAtLevel = byLevel.get(level)!;

			for (const doc of docsAtLevel) {
				// Check limits
				if (totalProcessed >= maxDocs) {
					this.logger.warning(`Batch size limit reached (${maxDocs} documents)`);
					shouldBreak = true;
					break;
				}

				const elapsed = Date.now() - startTime;
				if (elapsed >= timeLimitMs) {
					this.logger.warning(`Time limit reached (${options.timeLimitMinutes} minutes)`);
					shouldBreak = true;
					break;
				}

				// Process this doc through all remaining passes (depth-first)
				const startPass = (doc.pass_level ?? 0) + 1;

				this.logger.documentHeader(totalProcessed + 1, totalToProcess, doc.title);

				let currentDoc = doc; // Track the current version of the document

				for (let pass = startPass; pass <= Pass.RELATIONSHIPS; pass++) {
					if (!options.dryRun) {
						const passResult = await this.runPass(
							indexName,
							pass,
							{ reset: false, dryRun: false, verbose: options.verbose },
							[currentDoc],
							concurrency,
						);

						// Refresh document from database to get updated fields (summary, pass_level, etc.)
						// This ensures the next pass has access to data created by previous passes
						const refreshedDoc = await this.searchClient.getDocumentById(indexName, currentDoc.id);
						if (refreshedDoc) {
							currentDoc = refreshedDoc;
						}

						// Build compact result message (after refresh to get accurate counts)
						let resultMsg = '';
						if (pass === Pass.SUMMARY && passResult.processed > 0) {
							resultMsg = chalk.green('✓ Summarized');
						} else if (pass === Pass.ATOMS) {
							if (passResult.atomsCreated && passResult.atomsCreated > 0) {
								resultMsg = chalk.green(`✓ ${passResult.atomsCreated} atoms extracted`);
							} else {
								resultMsg = chalk.dim('No atoms');
							}
						} else if (pass === Pass.RELATIONSHIPS) {
							const relatedCount = currentDoc.related_ids?.length ?? 0;
							if (relatedCount > 0) {
								resultMsg = chalk.green(`✓ ${relatedCount} related docs`);
							} else {
								resultMsg = chalk.dim('No relations');
							}
						}

						if (resultMsg) {
							this.logger.passCompact(pass, this.getPassName(pass), resultMsg);
						}

						// Track results for each pass
						const existingResult = results.find((r) => r.pass === pass);
						if (existingResult) {
							existingResult.processed += passResult.processed;
							existingResult.total += passResult.total;
							if (pass === Pass.ATOMS && passResult.atomsCreated) {
								existingResult.atomsCreated =
									(existingResult.atomsCreated ?? 0) + passResult.atomsCreated;
							}
						} else {
							results.push({
								pass,
								processed: passResult.processed,
								total: passResult.total,
								indexName,
								...(pass === Pass.ATOMS && {
									atomsIndexName: `${indexName}-atoms`,
									atomsCreated: passResult.atomsCreated ?? 0,
								}),
							});
						}
					}
				}

				totalProcessed++;
			}
		}

		const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
		this.logger.success(`Processed ${totalProcessed} document(s) in ${elapsedSeconds}s`);

		if (options.dryRun) {
			this.logger.info('(Dry run - no changes made)');
		}

		return results;
	}

	private getPassName(pass: number): string {
		switch (pass) {
			case Pass.SUMMARY:
				return 'summaries';
			case Pass.ATOMS:
				return 'atoms';
			case Pass.RELATIONSHIPS:
				return 'relationships';
			default:
				return 'unknown';
		}
	}

	private async runPass(
		indexName: string,
		pass: number,
		options: SmartIndexOptions | { reset?: boolean; dryRun?: boolean; verbose?: boolean },
		documents: SearchDocument[],
		concurrency: number,
	): Promise<PassResult> {
		// Don't log here - parent method handles UI now

		if (options.dryRun) {
			return { processed: 0, skipped: 0, total: documents.length, errors: 0 };
		}

		switch (pass) {
			case Pass.SUMMARY:
				return this.runSummaryPass(indexName, documents, concurrency);
			case Pass.ATOMS:
				return this.runAtomsPass(indexName, documents, concurrency);
			case Pass.RELATIONSHIPS:
				return this.runRelationshipsPass(indexName, documents, concurrency);
			default:
				return { processed: 0, skipped: 0, total: 0, errors: 0 };
		}
	}

	private async getDocumentsForPass(
		indexName: string,
		pass: number,
		force: boolean,
	): Promise<SearchDocument[]> {
		if (force) {
			return this.searchClient.getAllDocuments(indexName);
		}

		// Use Meilisearch filtering to get only documents that need processing
		// Documents where pass_level < pass OR pass_level doesn't exist
		try {
			const needsProcessing = await this.searchClient.getDocumentsWithFilter(
				indexName,
				`pass_level < ${pass}`,
			);
			// Also get documents without pass_level (not yet smart-indexed)
			const allDocs = await this.searchClient.getAllDocuments(indexName);
			const processedIds = new Set(needsProcessing.map((d) => d.id));
			const unindexed = allDocs.filter(
				(d) => d.pass_level === undefined && !processedIds.has(d.id),
			);
			return [...needsProcessing, ...unindexed];
		} catch {
			// Fallback to JS filtering if Meilisearch filter fails
			const allDocs = await this.searchClient.getAllDocuments(indexName);
			return allDocs.filter((doc) => !doc.pass_level || doc.pass_level < pass);
		}
	}

	private async runSummaryPass(
		indexName: string,
		documents: SearchDocument[],
		concurrency: number,
	): Promise<PassResult> {
		let processed = 0;
		let errors = 0;
		const semaphore = new Semaphore(concurrency);
		const total = documents.length;

		const processDoc = async (doc: SearchDocument): Promise<void> => {
			await semaphore.acquire();
			try {
				const { system, user } = buildSummaryPrompt(doc.title, doc.content);
				const summary = await this.llmClient.complete(system, user, { maxTokens: 256 });

				await this.searchClient.updateDocuments(indexName, [
					{
						id: doc.id,
						summary: summary.trim(),
						smart_indexed_at: Date.now(),
						pass_level: Pass.SUMMARY,
					},
				]);

				processed++;
			} catch (error) {
				errors++;
				this.logger.error(`Error summarizing ${doc.title}: ${formatError(error)}`);
			} finally {
				semaphore.release();
			}
		};

		await Promise.all(documents.map(processDoc));

		return { processed, skipped: 0, total, errors };
	}

	private async runAtomsPass(
		indexName: string,
		documents: SearchDocument[],
		concurrency: number,
	): Promise<PassResult> {
		// Ensure atoms index exists (non-destructive)
		await this.searchClient.ensureAtomsIndex(indexName);

		let processed = 0;
		let errors = 0;
		let atomsCreated = 0;
		const semaphore = new Semaphore(concurrency);
		const total = documents.length;

		const processDoc = async (doc: SearchDocument): Promise<void> => {
			await semaphore.acquire();
			try {
				// Delete existing atoms for this document
				await this.searchClient.deleteAtomsForDocument(indexName, doc.id);

				const { system, user } = buildAtomsPrompt(doc.title, doc.content);
				const response = await this.llmClient.complete(system, user, { maxTokens: 1024 });
				const atomContents = parseJsonArray(response);

				if (atomContents.length > 0) {
					const atoms = createAtoms(doc, atomContents);
					await this.searchClient.addAtoms(indexName, atoms);
					atomsCreated += atoms.length;
				}

				await this.searchClient.updateDocuments(indexName, [
					{
						id: doc.id,
						smart_indexed_at: Date.now(),
						pass_level: Pass.ATOMS,
					},
				]);

				processed++;
			} catch (error) {
				errors++;
				this.logger.error(`Error extracting atoms from ${doc.title}: ${formatError(error)}`);
			} finally {
				semaphore.release();
			}
		};

		await Promise.all(documents.map(processDoc));

		return { processed, skipped: 0, total, errors, atomsCreated };
	}

	private async runRelationshipsPass(
		indexName: string,
		documents: SearchDocument[],
		concurrency: number,
	): Promise<PassResult> {
		// Get all documents with summaries for candidate matching
		const allDocs = await this.searchClient.getAllDocuments(indexName);
		const docsWithSummaries = allDocs.filter((doc) => doc.summary);

		let processed = 0;
		let skipped = 0;
		let errors = 0;

		// Collect bidirectional updates to apply in bulk at the end
		// Map: docId -> Set of related IDs to add
		const bidirectionalUpdates = new Map<string, Set<string>>();

		const semaphore = new Semaphore(concurrency);
		const total = documents.length;

		const processDoc = async (doc: SearchDocument): Promise<void> => {
			await semaphore.acquire();
			try {
				if (!doc.summary) {
					// Skip docs without summary - they need pass 1 first
					skipped++;
					this.logger.warning(`Skipped (no summary): ${doc.title}`);
					return;
				}

				// Get candidates (exclude self, prefer recent docs)
				const candidates: RelationshipCandidate[] = docsWithSummaries
					.filter((d) => d.id !== doc.id)
					.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)) // Recency bias
					.slice(0, MAX_RELATIONSHIP_CANDIDATES)
					.map((d) => ({
						id: d.id,
						title: d.title,
						summary: d.summary!,
					}));

				let validRelatedIds: string[] = [];

				if (candidates.length > 0) {
					const { system, user } = buildRelationshipsPrompt(doc.title, doc.summary, candidates);
					const response = await this.llmClient.complete(system, user, { maxTokens: 512 });
					const relatedIds = parseJsonArray(response);

					// Filter to only valid candidate IDs
					validRelatedIds = relatedIds.filter((id) => candidates.some((c) => c.id === id));
				}

				// Update this document with its related IDs
				await this.searchClient.updateDocuments(indexName, [
					{
						id: doc.id,
						related_ids: validRelatedIds,
						smart_indexed_at: Date.now(),
						pass_level: Pass.RELATIONSHIPS,
					},
				]);

				// Record bidirectional updates to apply later
				for (const relatedId of validRelatedIds) {
					if (!bidirectionalUpdates.has(relatedId)) {
						bidirectionalUpdates.set(relatedId, new Set());
					}
					bidirectionalUpdates.get(relatedId)!.add(doc.id);
				}

				processed++;
			} catch (error) {
				errors++;
				this.logger.error(`Error finding relationships for ${doc.title}: ${formatError(error)}`);
			} finally {
				semaphore.release();
			}
		};

		await Promise.all(documents.map(processDoc));

		// Apply bidirectional updates in bulk with concurrency control
		if (bidirectionalUpdates.size > 0) {
			this.logger.info(
				`Applying ${bidirectionalUpdates.size} bidirectional relationship updates...`,
			);

			// Use semaphore to avoid overwhelming database with parallel requests
			const updateSemaphore = new Semaphore(concurrency);
			const updatePromises: Promise<void>[] = [];

			for (const [docId, newRelatedIds] of bidirectionalUpdates) {
				updatePromises.push(
					(async () => {
						await updateSemaphore.acquire();
						try {
							const doc = await this.searchClient.getDocumentById(indexName, docId);
							if (doc) {
								const existingRelated = new Set(doc.related_ids ?? []);
								for (const id of newRelatedIds) {
									existingRelated.add(id);
								}
								// Limit total related IDs per document
								const updatedRelated = Array.from(existingRelated).slice(
									0,
									MAX_RELATED_IDS_PER_DOC,
								);
								await this.searchClient.updateDocuments(indexName, [
									{
										id: docId,
										related_ids: updatedRelated,
									},
								]);
							} else {
								this.logger.warning(`Document ${docId} not found for bidirectional update`);
							}
						} catch (error) {
							this.logger.error(
								`Error updating bidirectional relationship for ${docId}: ${formatError(error)}`,
							);
						} finally {
							updateSemaphore.release();
						}
					})(),
				);
			}

			await Promise.all(updatePromises);
		}

		return { processed, skipped, total, errors };
	}

	async checkPrerequisites(dirPath: string): Promise<{ ok: boolean; message: string }> {
		// Check Meilisearch
		const meiliHealth = await this.searchClient.checkHealth();
		if (!meiliHealth.healthy) {
			return { ok: false, message: meiliHealth.message };
		}

		// Check LLM
		const llmHealth = await this.llmClient.checkHealth();
		if (!llmHealth.healthy) {
			return { ok: false, message: llmHealth.message };
		}

		// Check index exists
		const indexName = deriveIndexName(dirPath);
		const status = await this.searchClient.getStatus(indexName);
		if (status.documentCount === undefined || status.documentCount === 0) {
			return {
				ok: false,
				message: `Index "${indexName}" is empty or does not exist. Run "md search index --path ${dirPath}" first.`,
			};
		}

		// Test LLM with a simple completion to catch model errors early
		try {
			await this.llmClient.complete('You are a helpful assistant.', 'Say "OK" and nothing else.', {
				maxTokens: 10,
			});
		} catch (error) {
			const errorMsg = formatError(error);
			return { ok: false, message: `LLM test failed: ${errorMsg}` };
		}

		return { ok: true, message: 'All prerequisites met' };
	}
}

export function createSmartIndexer(options?: {
	searchClient?: SearchClient;
	llmClient?: LLMClient;
	verbose?: boolean;
	concurrency?: number;
}): SmartIndexer {
	return new SmartIndexer(options);
}
