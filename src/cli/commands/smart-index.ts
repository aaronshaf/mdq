import path from 'node:path';
import { createLLMClient } from '../../lib/llm/index.js';
import { createLogger } from '../../lib/logger.js';
import {
	type Pass,
	type SmartIndexResult,
	createSearchClient,
	createSmartIndexer,
} from '../../lib/search/index.js';

export interface SmartIndexCommandOptions {
	pass: Pass | 'all';
	reset: boolean;
	dryRun: boolean;
	only: boolean;
	verbose: boolean;
}

/**
 * @deprecated Use runSmartIndexAutoCommand instead. Manual pass management is deprecated.
 * This function is kept for backwards compatibility but will be removed in a future version.
 */
export async function runSmartIndexCommand(
	dirPath: string,
	options: SmartIndexCommandOptions,
): Promise<SmartIndexResult[]> {
	const absolutePath = path.resolve(dirPath);

	const searchClient = createSearchClient();
	const llmClient = createLLMClient();

	const indexer = createSmartIndexer({
		searchClient,
		llmClient,
		verbose: options.verbose,
	});

	// Check prerequisites
	const prereq = await indexer.checkPrerequisites(absolutePath);
	if (!prereq.ok) {
		throw new Error(prereq.message);
	}

	if (options.verbose) {
		const config = llmClient.getConfig();
		console.error(`Using LLM: ${config.model} at ${config.endpoint}`);
		console.error(`Directory: ${absolutePath}`);
		console.error(`Pass: ${options.pass}${options.only ? ' (only)' : ''}`);
		if (options.reset) console.error('Reset: enabled');
		if (options.dryRun) console.error('Dry run: enabled');
	}

	const results = await indexer.smartIndex(absolutePath, {
		pass: options.pass,
		reset: options.reset,
		dryRun: options.dryRun,
		only: options.only,
		verbose: options.verbose,
	});

	return results;
}

export async function runSmartIndexAutoCommand(
	dirPath: string,
	options: {
		batchSize?: number;
		timeLimitMinutes?: number;
		reset: boolean;
		dryRun: boolean;
		verbose: boolean;
	},
): Promise<SmartIndexResult[]> {
	const absolutePath = path.resolve(dirPath);

	const searchClient = createSearchClient();
	const llmClient = createLLMClient();

	const indexer = createSmartIndexer({
		searchClient,
		llmClient,
		verbose: options.verbose,
	});

	// Check prerequisites
	const prereq = await indexer.checkPrerequisites(absolutePath);
	if (!prereq.ok) {
		throw new Error(prereq.message);
	}

	if (options.verbose) {
		const config = llmClient.getConfig();
		const logger = createLogger(true);
		console.log(''); // Empty line before config
		logger.config('Using LLM', `${config.model} at ${config.endpoint}`);
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
		console.log(''); // Empty line after config
	}

	const results = await indexer.smartIndexAuto(absolutePath, {
		batchSize: options.batchSize,
		timeLimitMinutes: options.timeLimitMinutes,
		reset: options.reset,
		dryRun: options.dryRun,
		verbose: options.verbose,
	});

	return results;
}

export async function runSmartIndexStatusCommand(_dirPath: string): Promise<{
	meiliHealthy: boolean;
	llmHealthy: boolean;
	meiliMessage: string;
	llmMessage: string;
	llmEndpoint: string;
	llmModel: string;
}> {
	const searchClient = createSearchClient();
	const llmClient = createLLMClient();

	const [meiliHealth, llmHealth] = await Promise.all([
		searchClient.checkHealth(),
		llmClient.checkHealth(),
	]);

	const config = llmClient.getConfig();

	return {
		meiliHealthy: meiliHealth.healthy,
		llmHealthy: llmHealth.healthy,
		meiliMessage: meiliHealth.message,
		llmMessage: llmHealth.message,
		llmEndpoint: config.endpoint,
		llmModel: config.model,
	};
}
