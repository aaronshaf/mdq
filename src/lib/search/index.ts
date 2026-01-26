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
	parseMdignore,
	readMdignore,
	shouldIgnore,
} from './mdignore.js';
export {
	SmartIndexer,
	createSmartIndexer,
	Pass,
	type SmartIndexOptions,
} from './smart-indexer.js';
export {
	createAtoms,
	deduplicateAtoms,
	generateAtomId,
	getAtomsIndexName,
	groupAtomsByDocument,
} from './atoms.js';
export type {
	Atom,
	IndexResult,
	IndexStatus,
	SearchDocument,
	SearchOptions,
	SearchResponse,
	SearchResult,
	SmartIndexResult,
} from './types.js';
