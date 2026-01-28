import { createConnectionError, createNotFoundError } from '../../lib/errors.js';
import {
	type IndexResult,
	type IndexStatus,
	type SearchOptions,
	type SearchResponse,
	createSearchClient,
	deriveIndexName,
	indexDirectory,
} from '../../lib/search/index.js';

export async function runSearchCommand(
	basePath: string,
	options: SearchOptions,
): Promise<SearchResponse> {
	const client = createSearchClient();
	const indexName = deriveIndexName(basePath);

	// Check if index exists
	const status = await client.getStatus(indexName);
	if (status.status === 'error') {
		throw createConnectionError(status.message);
	}

	if (status.documentCount === undefined) {
		throw createNotFoundError(`Index "${indexName}" not found. Run "mdq index" first.`, indexName);
	}

	return client.search(indexName, options);
}

export async function runSearchIndexCommand(
	basePath: string,
	verbose = false,
): Promise<IndexResult> {
	const client = createSearchClient();

	// Check connection first
	const status = await client.getStatus('_health_check_');
	if (status.status === 'error') {
		throw createConnectionError(status.message);
	}

	return indexDirectory(basePath, client, verbose);
}

export async function runSearchStatusCommand(basePath: string): Promise<IndexStatus> {
	const client = createSearchClient();
	const indexName = deriveIndexName(basePath);

	return client.getStatus(indexName);
}

export async function runStatusCommand(): Promise<{ healthy: boolean; message: string }> {
	const client = createSearchClient();
	return client.checkHealth();
}
