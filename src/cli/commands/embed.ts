import path from 'node:path';
import { createLLMClient } from '../../lib/llm/index.js';
import { createLogger } from '../../lib/logger.js';
import { type EmbedResult, createEmbedder, createSearchClient } from '../../lib/search/index.js';

export interface EmbedCommandOptions {
	batchSize?: number;
	timeLimitMinutes?: number;
	reset: boolean;
	dryRun: boolean;
	verbose: boolean;
}

export async function runEmbedCommand(
	dirPath: string,
	options: EmbedCommandOptions,
): Promise<EmbedResult> {
	const absolutePath = path.resolve(dirPath);

	const searchClient = createSearchClient();
	const llmClient = createLLMClient();

	const embedder = createEmbedder({
		searchClient,
		llmClient,
		verbose: options.verbose,
	});

	// Check prerequisites
	const prereq = await embedder.checkPrerequisites(absolutePath);
	if (!prereq.ok) {
		throw new Error(prereq.message);
	}

	// Always show embedding model being used
	const embeddingConfig = llmClient.getEmbeddingConfig();
	const logger = createLogger(options.verbose);
	console.log(''); // Empty line before config
	logger.config('Embedding model', `${embeddingConfig.model} at ${embeddingConfig.endpoint}`);
	if (options.verbose) {
		logger.config('Directory', absolutePath);
		if (options.batchSize) {
			logger.config('Batch size', `${options.batchSize} documents`);
		} else {
			logger.config('Batch size', 'unlimited (will process all remaining documents)');
		}
		if (options.timeLimitMinutes) {
			logger.config('Time limit', `${options.timeLimitMinutes} minutes`);
		}
		if (options.reset) logger.config('Reset', 'enabled');
		if (options.dryRun) logger.config('Dry run', 'enabled');
	}
	console.log(''); // Empty line after config

	const result = await embedder.embed(absolutePath, {
		batchSize: options.batchSize,
		timeLimitMinutes: options.timeLimitMinutes,
		reset: options.reset,
		dryRun: options.dryRun,
		verbose: options.verbose,
	});

	return result;
}

export async function runEmbedStatusCommand(_dirPath: string): Promise<{
	meiliHealthy: boolean;
	embeddingHealthy: boolean;
	meiliMessage: string;
	embeddingMessage: string;
	embeddingEndpoint: string;
	embeddingModel: string;
}> {
	const searchClient = createSearchClient();
	const llmClient = createLLMClient();

	const [meiliHealth, embeddingHealth] = await Promise.all([
		searchClient.checkHealth(),
		llmClient.checkEmbeddingHealth(),
	]);

	const embeddingConfig = llmClient.getEmbeddingConfig();

	return {
		meiliHealthy: meiliHealth.healthy,
		embeddingHealthy: embeddingHealth.healthy,
		meiliMessage: meiliHealth.message,
		embeddingMessage: embeddingHealth.message,
		embeddingEndpoint: embeddingConfig.endpoint,
		embeddingModel: embeddingConfig.model,
	};
}
