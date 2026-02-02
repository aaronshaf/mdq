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
export {
	filterIgnored,
	parseMdqignore,
	readMdqignore,
	shouldIgnore,
} from './mdqignore.js';
export {
	Embedder,
	createEmbedder,
	// Legacy aliases
	SmartIndexer,
	createSmartIndexer,
	type EmbedOptions,
	type SmartIndexOptions,
} from './smart-indexer.js';
export { chunkText, estimateTokens, type Chunk, type ChunkOptions } from './chunker.js';
export type {
	ChunkDocument,
	EmbedResult,
	IndexResult,
	IndexStatus,
	SearchDocument,
	SearchOptions,
	SearchResponse,
	SearchResult,
	// Legacy alias
	EmbedResult as SmartIndexResult,
} from './types.js';
