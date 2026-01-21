export { SearchClient, createSearchClient, type SearchClientConfig } from './client.js';
export {
	buildDateFilters,
	dateToTimestamp,
	durationToMs,
	filtersToMeilisearchString,
	parseDuration,
	timestampFromDuration,
	type DateFilter,
	type DurationParts,
} from './date-utils.js';
export { Indexer, deriveIndexName, indexDirectory, scanMarkdownFiles } from './indexer.js';
export type {
	IndexResult,
	IndexStatus,
	SearchDocument,
	SearchOptions,
	SearchResponse,
	SearchResult,
} from './types.js';
