import path from 'node:path';
import { parseMarkdownFile } from '../markdown/index.js';
import { type SearchClient, deriveIndexName, groupAtomsByDocument } from '../search/index.js';
import type { Source } from './sources.js';
import type {
	ReadToolInput,
	ReadToolOutput,
	SearchResultWithSource,
	SearchToolInput,
	SearchToolOutput,
} from './types.js';

// Security: Prevent path traversal attacks by ensuring target is within base directory
function isPathWithinBase(basePath: string, targetPath: string): boolean {
	const resolvedBase = path.resolve(basePath);
	const resolvedTarget = path.resolve(targetPath);
	return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

type SortField = 'created_at' | '-created_at' | 'updated_at' | '-updated_at';

function getSortComparator(
	sort: SortField,
): (a: SearchResultWithSource, b: SearchResultWithSource) => number {
	const isDescending = sort.startsWith('-');
	const field = (isDescending ? sort.slice(1) : sort) as 'created_at' | 'updated_at';

	return (a, b) => {
		const aVal = a[field] ?? 0;
		const bVal = b[field] ?? 0;
		return isDescending ? bVal - aVal : aVal - bVal;
	};
}

interface SourceSearchResult {
	source: string;
	results: SearchResultWithSource[];
	total: number;
	error?: string;
}

export async function handleSearch(
	sources: Source[],
	sourceMap: Map<string, Source>,
	client: SearchClient,
	input: SearchToolInput,
): Promise<SearchToolOutput> {
	// Determine which sources to search
	let sourcesToSearch: Source[];
	if (input.source) {
		const source = sourceMap.get(input.source.toLowerCase());
		if (!source) {
			throw new Error(
				`Unknown source: "${input.source}". Available sources: ${Array.from(sourceMap.keys()).join(', ')}`,
			);
		}
		sourcesToSearch = [source];
	} else {
		sourcesToSearch = sources;
	}

	// Search all relevant sources in parallel, handling partial failures
	const searchPromises = sourcesToSearch.map(async (source): Promise<SourceSearchResult> => {
		const indexName = deriveIndexName(source.path);
		try {
			const response = await client.search(indexName, {
				query: input.query,
				limit: input.limit,
				labels: input.labels,
				author: input.author,
				createdAfter: input.created_after,
				createdBefore: input.created_before,
				createdWithin: input.created_within,
				updatedAfter: input.updated_after,
				updatedBefore: input.updated_before,
				updatedWithin: input.updated_within,
				stale: input.stale,
				sort: input.sort,
			});

			return {
				source: source.name,
				results: response.results.map((r) => ({
					id: r.id,
					title: r.title,
					path: r.path,
					snippet: r.snippet,
					labels: r.labels,
					author_email: r.author_email,
					created_at: r.created_at,
					updated_at: r.updated_at,
					child_count: r.child_count,
					summary: r.summary,
					related_ids: r.related_ids,
					atoms: r.atoms,
					source: source.name,
				})),
				total: response.total,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[md] search error for source "${source.name}": ${message}`);
			return {
				source: source.name,
				results: [],
				total: 0,
				error: message,
			};
		}
	});

	const searchResults = await Promise.all(searchPromises);

	// Combine results from all sources
	const allResults: SearchResultWithSource[] = [];
	let totalCount = 0;
	const errors: string[] = [];

	for (const { source: sourceName, results, total, error } of searchResults) {
		if (error) {
			errors.push(`${sourceName}: ${error}`);
		} else {
			totalCount += total;
			allResults.push(...results);
		}
	}

	// Sort combined results globally if sorting was requested
	if (input.sort && sourcesToSearch.length > 1) {
		allResults.sort(getSortComparator(input.sort));
	}

	// Apply limit to combined results
	const limitedResults = input.limit ? allResults.slice(0, input.limit) : allResults;

	// If all sources failed, throw an error
	if (errors.length === sourcesToSearch.length && sourcesToSearch.length > 0) {
		throw new Error(`All sources failed: ${errors.join('; ')}`);
	}

	// Search atoms if requested
	if (input.search_atoms) {
		const atomSearchPromises = sourcesToSearch.map(async (source) => {
			const indexName = deriveIndexName(source.path);
			try {
				const atomHits = await client.searchAtoms(indexName, input.query, input.limit ?? 10);

				// Group atoms by document and get unique doc IDs
				const atomsByDoc = groupAtomsByDocument(atomHits);
				const docIds = Array.from(atomsByDoc.keys());

				// Fetch parent documents that aren't already in results
				const existingIds = new Set(limitedResults.map((r) => r.id));
				const newDocIds = docIds.filter((id) => !existingIds.has(id));

				for (const docId of newDocIds) {
					const doc = await client.getDocumentById(indexName, docId);
					if (doc) {
						limitedResults.push({
							id: doc.id,
							title: doc.title,
							path: doc.path,
							labels: doc.labels,
							author_email: doc.author_email,
							created_at: doc.created_at,
							updated_at: doc.updated_at,
							child_count: doc.child_count,
							summary: doc.summary,
							related_ids: doc.related_ids,
							atoms: await client.getAtomsForDocument(indexName, docId).catch(() => []),
							source: source.name,
						});
					}
				}
			} catch {
				// Atoms index might not exist, continue silently
			}
		});

		await Promise.all(atomSearchPromises);
	}

	// Fetch related documents if requested
	if (input.include_related) {
		const relatedIds = new Set<string>();
		const existingIds = new Set(limitedResults.map((r) => r.id));

		// Collect all related IDs from current results
		for (const result of limitedResults) {
			if (result.related_ids) {
				for (const relId of result.related_ids) {
					if (!existingIds.has(relId)) {
						relatedIds.add(relId);
					}
				}
			}
		}

		// Fetch related documents
		if (relatedIds.size > 0) {
			for (const source of sourcesToSearch) {
				const indexName = deriveIndexName(source.path);
				for (const relId of relatedIds) {
					try {
						const doc = await client.getDocumentById(indexName, relId);
						if (doc && !existingIds.has(doc.id)) {
							limitedResults.push({
								id: doc.id,
								title: doc.title,
								path: doc.path,
								labels: doc.labels,
								author_email: doc.author_email,
								created_at: doc.created_at,
								updated_at: doc.updated_at,
								child_count: doc.child_count,
								summary: doc.summary,
								related_ids: doc.related_ids,
								atoms: await client.getAtomsForDocument(indexName, relId).catch(() => []),
								source: source.name,
							});
							existingIds.add(doc.id);
						}
					} catch {
						// Document might not exist in this source, continue
					}
				}
			}
		}
	}

	return {
		results: limitedResults,
		total: totalCount,
	};
}

export async function handleRead(
	sources: Source[],
	sourceMap: Map<string, Source>,
	client: SearchClient,
	input: ReadToolInput,
): Promise<ReadToolOutput | null> {
	// Validate that at least one identifier is provided
	if (!input.path && !input.id) {
		return null;
	}

	// Determine which sources to search
	let sourcesToSearch: Source[];
	if (input.source) {
		const source = sourceMap.get(input.source.toLowerCase());
		if (!source) {
			throw new Error(
				`Unknown source: "${input.source}". Available sources: ${Array.from(sourceMap.keys()).join(', ')}`,
			);
		}
		sourcesToSearch = [source];
	} else {
		sourcesToSearch = sources;
	}

	// Try to find the document in the sources (continue on per-source errors)
	for (const source of sourcesToSearch) {
		try {
			const indexName = deriveIndexName(source.path);
			let filePath: string | null = null;

			if (input.path) {
				const candidatePath = path.join(source.path, input.path);
				// Validate path doesn't escape base directory
				if (!isPathWithinBase(source.path, candidatePath)) {
					continue;
				}
				filePath = candidatePath;
			} else if (input.id) {
				// Look up document by ID to get path
				const doc = await client.getDocumentById(indexName, input.id);
				if (doc) {
					const candidatePath = path.join(source.path, doc.path);
					// Validate path doesn't escape base directory
					if (!isPathWithinBase(source.path, candidatePath)) {
						continue;
					}
					filePath = candidatePath;
				}
			}

			if (!filePath) {
				continue;
			}

			// Check if file exists
			const file = Bun.file(filePath);
			if (!(await file.exists())) {
				continue;
			}

			const parsed = await parseMarkdownFile(filePath, source.path);
			const stat = await file.stat();

			return {
				id: parsed.id,
				title: parsed.title,
				content: parsed.content,
				path: parsed.path,
				labels: parsed.frontmatter.labels,
				author_email: parsed.frontmatter.author_email,
				created_at: stat?.birthtime.getTime(),
				updated_at: stat?.mtime.getTime(),
				child_count: parsed.frontmatter.child_count,
				source: source.name,
			};
		} catch (error) {
			// Log and continue to next source on errors (e.g., missing index, network issues)
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[md] read error for source "${source.name}": ${message}`);
		}
	}

	return null;
}
