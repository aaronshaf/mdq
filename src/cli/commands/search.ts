import type { SourceConfig } from '../../lib/config/sources.js';
import { createConnectionError, createNotFoundError } from '../../lib/errors.js';
import {
	type IndexResult,
	type IndexStatus,
	type SearchOptions,
	type SearchResponse,
	type SearchResult,
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

export async function runSearchMultipleCommand(
	sources: SourceConfig[],
	options: SearchOptions,
): Promise<SearchResponse> {
	const client = createSearchClient();

	// Check Meilisearch health first
	const healthStatus = await client.getStatus('_health_check_');
	if (healthStatus.status === 'error') {
		throw createConnectionError(healthStatus.message);
	}

	// Timeout for individual source searches (30 seconds)
	const SEARCH_TIMEOUT_MS = 30000;

	// Search all sources in parallel
	const searchPromises = sources.map(async (source) => {
		const indexName = deriveIndexName(source.path);

		// Check if index exists
		const status = await client.getStatus(indexName);
		if (status.documentCount === undefined) {
			return { source: source.name, missing: true, results: [], error: null };
		}

		// Search this index with timeout
		try {
			const searchPromise = client.search(indexName, options);
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS);
			});

			const response = await Promise.race([searchPromise, timeoutPromise]);
			return { source: source.name, missing: false, results: response.results, error: null };
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return { source: source.name, missing: false, results: [], error: errorMsg };
		}
	});

	const searchResults = await Promise.all(searchPromises);

	// Collect errors and missing indices
	const missingIndices: string[] = [];
	const errors: Array<{ source: string; error: string }> = [];
	const allResults: Array<SearchResult & { _rrfScore: number; _sourceRank: number }> = [];

	for (const result of searchResults) {
		if (result.missing) {
			missingIndices.push(result.source);
		} else if (result.error) {
			errors.push({ source: result.source, error: result.error });
		} else {
			// Assign position-based scores using RRF formula: 1/(k+position)
			// where k=60 is the standard RRF constant
			const k = 60;
			result.results.forEach((searchResult, idx) => {
				const position = idx + 1; // 1-based position
				const rrfScore = 1 / (k + position);
				allResults.push({
					...searchResult,
					_rrfScore: rrfScore,
					_sourceRank: position,
				});
			});
		}
	}

	// If no sources had indices, throw an error
	if (allResults.length === 0 && missingIndices.length === sources.length) {
		const sourceNames = missingIndices.join(', ');
		throw createNotFoundError(
			`No indices found for sources: ${sourceNames}. Run "mdq index" first.`,
			sourceNames,
		);
	}

	// Sort by RRF score (highest first)
	allResults.sort((a, b) => b._rrfScore - a._rrfScore);

	const limit = options.limit ?? 10;
	const results = allResults.slice(0, limit).map(({ _rrfScore, _sourceRank, ...result }) => result);

	// Build warnings array from errors and missing indices
	const warnings: Array<{ source: string; message: string }> = [];

	for (const err of errors) {
		warnings.push({
			source: err.source,
			message: `Failed to search: ${err.error}`,
		});
	}

	for (const sourceName of missingIndices) {
		warnings.push({
			source: sourceName,
			message: 'Index not found. Run "mdq index" first.',
		});
	}

	return {
		results,
		total: allResults.length,
		query: options.query,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
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
