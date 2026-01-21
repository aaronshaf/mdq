import path from 'node:path';
import { parseMarkdownFile } from '../markdown/index.js';
import { createSearchClient, deriveIndexName } from '../search/index.js';
import type { ReadToolInput, ReadToolOutput, SearchToolInput, SearchToolOutput } from './types.js';

function isPathWithinBase(basePath: string, targetPath: string): boolean {
	const resolvedBase = path.resolve(basePath);
	const resolvedTarget = path.resolve(targetPath);
	return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

export async function handleSearch(
	basePath: string,
	input: SearchToolInput,
): Promise<SearchToolOutput> {
	const client = createSearchClient();
	const indexName = deriveIndexName(basePath);

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
		results: response.results.map((r) => ({
			id: r.id,
			title: r.title,
			path: r.path,
			snippet: r.snippet,
			labels: r.labels,
			author_email: r.author_email,
			created_at: r.created_at,
			updated_at: r.updated_at,
		})),
		total: response.total,
	};
}

export async function handleRead(
	basePath: string,
	input: ReadToolInput,
): Promise<ReadToolOutput | null> {
	// Validate that at least one identifier is provided
	if (!input.path && !input.id) {
		return null;
	}

	const client = createSearchClient();
	const indexName = deriveIndexName(basePath);

	let filePath: string | null = null;

	if (input.path) {
		const candidatePath = path.join(basePath, input.path);
		// Validate path doesn't escape base directory
		if (!isPathWithinBase(basePath, candidatePath)) {
			return null;
		}
		filePath = candidatePath;
	} else if (input.id) {
		// Look up document by ID to get path
		const doc = await client.getDocumentById(indexName, input.id);
		if (doc) {
			const candidatePath = path.join(basePath, doc.path);
			// Validate path doesn't escape base directory
			if (!isPathWithinBase(basePath, candidatePath)) {
				return null;
			}
			filePath = candidatePath;
		}
	}

	if (!filePath) {
		return null;
	}

	// Check if file exists
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		return null;
	}

	const parsed = await parseMarkdownFile(filePath, basePath);
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
	};
}
