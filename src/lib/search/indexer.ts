import os from 'node:os';
import path from 'node:path';
import { Glob } from 'bun';
import { parseMarkdownFile } from '../markdown/index.js';
import { type SearchClient, createSearchClient } from './client.js';
import { readMdqignore, shouldIgnore } from './mdqignore.js';
import type { IndexResult, SearchDocument } from './types.js';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg']);
const EXCLUDED_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);

export function deriveIndexName(dirPath: string): string {
	const home = os.homedir();
	const absolutePath = path.resolve(dirPath);

	let relativePath: string;
	if (absolutePath.startsWith(home)) {
		relativePath = path.relative(home, absolutePath);
	} else {
		relativePath = absolutePath;
	}

	// Sanitize path for index name
	const sanitized = relativePath
		.replace(/^\/+/, '')
		.replace(/[/\\]/g, '-')
		.replace(/[^a-zA-Z0-9-_]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();

	return `md-${sanitized}`;
}

function shouldExclude(filePath: string, basePath: string): boolean {
	const relativePath = path.relative(basePath, filePath);
	const parts = relativePath.split(path.sep);

	// Check for excluded directories in path
	for (const part of parts) {
		if (EXCLUDED_DIRS.has(part) || part.startsWith('.')) {
			return true;
		}
	}

	// Check for excluded files
	const filename = path.basename(filePath);
	if (EXCLUDED_FILES.has(filename)) {
		return true;
	}

	return false;
}

export async function scanMarkdownFiles(
	basePath: string,
	mdqignorePatterns: string[] = [],
): Promise<string[]> {
	const absoluteBase = path.resolve(basePath);
	const glob = new Glob('**/*.md');
	const files: string[] = [];

	for await (const file of glob.scan({ cwd: absoluteBase, absolute: true })) {
		if (!shouldExclude(file, absoluteBase)) {
			// Check .mdqignore patterns
			const relativePath = path.relative(absoluteBase, file);
			if (!shouldIgnore(relativePath, mdqignorePatterns)) {
				files.push(file);
			}
		}
	}

	return files;
}

interface ParseResult {
	document: SearchDocument | null;
	error?: string;
}

/**
 * Resolve a date field by prioritizing frontmatter over filesystem dates
 * Validates that the frontmatter date is valid before using it
 * Note: gray-matter may parse ISO dates as Date objects, so we handle both strings and Dates
 */
function resolveDateField(
	frontmatterDate: string | Date | undefined,
	filesystemDate: Date | undefined,
): number | undefined {
	// Try frontmatter date first
	if (frontmatterDate) {
		// Handle Date objects (gray-matter may parse ISO dates as Date)
		if (frontmatterDate instanceof Date) {
			const timestamp = frontmatterDate.getTime();
			if (!Number.isNaN(timestamp)) {
				return timestamp;
			}
		}
		// Handle strings
		else if (typeof frontmatterDate === 'string') {
			const trimmed = frontmatterDate.trim();
			if (trimmed) {
				const timestamp = new Date(trimmed).getTime();
				if (!Number.isNaN(timestamp)) {
					return timestamp;
				}
			}
		}
	}
	// Fall back to filesystem date
	return filesystemDate?.getTime();
}

async function parseFileToDocument(
	file: string,
	basePath: string,
	verbose = false,
): Promise<ParseResult> {
	try {
		const parsed = await parseMarkdownFile(file, basePath);
		const stat = await Bun.file(file).stat();

		// Prioritize frontmatter dates over filesystem dates
		// This preserves real creation dates across git operations
		const createdAt = resolveDateField(parsed.frontmatter.created_at, stat?.birthtime);

		const updatedAt = resolveDateField(parsed.frontmatter.updated_at, stat?.mtime);

		// Log warnings for invalid dates in verbose mode
		if (verbose) {
			// Check if frontmatter date was provided but couldn't be parsed
			if (parsed.frontmatter.created_at) {
				const date = parsed.frontmatter.created_at;
				let isInvalid = false;
				if (date instanceof Date) {
					isInvalid = Number.isNaN(date.getTime());
				} else if (typeof date === 'string') {
					const trimmed = date.trim();
					if (trimmed) {
						isInvalid = Number.isNaN(new Date(trimmed).getTime());
					}
				}
				if (isInvalid) {
					console.error(
						`Warning: Invalid created_at date "${parsed.frontmatter.created_at}" in ${parsed.path}, using filesystem date`,
					);
				}
			}
			if (parsed.frontmatter.updated_at) {
				const date = parsed.frontmatter.updated_at;
				let isInvalid = false;
				if (date instanceof Date) {
					isInvalid = Number.isNaN(date.getTime());
				} else if (typeof date === 'string') {
					const trimmed = date.trim();
					if (trimmed) {
						isInvalid = Number.isNaN(new Date(trimmed).getTime());
					}
				}
				if (isInvalid) {
					console.error(
						`Warning: Invalid updated_at date "${parsed.frontmatter.updated_at}" in ${parsed.path}, using filesystem date`,
					);
				}
			}
		}

		// Extract reference field if present (for Chicago-style citations)
		const reference =
			typeof parsed.frontmatter.reference === 'string' ? parsed.frontmatter.reference : undefined;

		// Extract curatorNote field if present (for curator commentary)
		// Treat empty/whitespace-only strings as missing
		const rawNote = parsed.frontmatter.curatorNote;
		const curatorNote = typeof rawNote === 'string' && rawNote.trim() ? rawNote : undefined;

		return {
			document: {
				id: parsed.id,
				title: parsed.title,
				content: parsed.content,
				path: parsed.path,
				labels: parsed.frontmatter.labels,
				author_email: parsed.frontmatter.author_email,
				created_at: createdAt,
				updated_at: updatedAt,
				child_count: parsed.frontmatter.child_count,
				reference,
				curatorNote,
			},
		};
	} catch (error) {
		return {
			document: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function parseAllFiles(
	files: string[],
	basePath: string,
	verbose: boolean,
): Promise<{ documents: SearchDocument[]; errors: number }> {
	const documents: SearchDocument[] = [];
	let errors = 0;

	for (const file of files) {
		const result = await parseFileToDocument(file, basePath, verbose);
		if (result.document) {
			documents.push(result.document);
		} else {
			errors++;
			if (verbose) {
				console.error(`Error parsing ${file}: ${result.error ?? 'Unknown error'}`);
			}
		}
	}

	return { documents, errors };
}

export async function indexDirectory(
	dirPath: string,
	client?: SearchClient,
	verbose = false,
): Promise<IndexResult> {
	const absolutePath = path.resolve(dirPath);
	const searchClient = client ?? createSearchClient();
	const indexName = deriveIndexName(absolutePath);

	// Read .mdqignore patterns
	const mdqignorePatterns = await readMdqignore(absolutePath);
	if (verbose && mdqignorePatterns.length > 0) {
		console.error(`Loaded ${mdqignorePatterns.length} ignore patterns from .mdqignore`);
	}

	const files = await scanMarkdownFiles(absolutePath, mdqignorePatterns);
	if (verbose) console.error(`Found ${files.length} markdown files`);

	// Preserve embedding metadata from existing documents before recreating index
	const existingEmbedMetadata = new Map<
		string,
		{ embedded_at?: number; chunk_count?: number; updated_at?: number }
	>();

	// Check if index exists before trying to read documents
	const indexExists = await searchClient.indexExists(indexName);
	if (indexExists) {
		const existingDocs = await searchClient.getAllDocuments(indexName);
		for (const doc of existingDocs) {
			existingEmbedMetadata.set(doc.id, {
				embedded_at: doc.embedded_at,
				chunk_count: doc.chunk_count,
				updated_at: doc.updated_at,
			});
		}
		if (verbose && existingEmbedMetadata.size > 0) {
			console.error(`Loaded metadata from ${existingEmbedMetadata.size} existing documents`);
		}
	}

	if (verbose) console.error(`Recreating index: ${indexName}`);
	await searchClient.deleteIndex(indexName);
	await searchClient.createIndex(indexName);

	const { documents, errors } = await parseAllFiles(files, absolutePath, verbose);

	// Restore embedding metadata for unchanged documents
	let preservedCount = 0;
	let changedCount = 0;
	for (const doc of documents) {
		const existing = existingEmbedMetadata.get(doc.id);
		if (existing) {
			// Document is unchanged if updated_at hasn't changed
			const isUnchanged = existing.updated_at === doc.updated_at;

			if (isUnchanged) {
				// Preserve embedding metadata
				doc.embedded_at = existing.embedded_at;
				doc.chunk_count = existing.chunk_count;
				preservedCount++;
			} else {
				changedCount++;
			}
			// If changed (updated_at differs), leave embedded_at undefined
			// so it will be re-embedded on next `mdq embed`
		}
	}

	if (verbose && existingEmbedMetadata.size > 0) {
		console.error(
			`Embedding metadata: ${preservedCount} preserved, ${changedCount} invalidated (documents changed)`,
		);
	}

	if (documents.length > 0) {
		await searchClient.addDocuments(indexName, documents);
	}

	if (verbose) console.error(`Indexed ${documents.length} documents (${errors} errors)`);

	return { indexed: documents.length, total: files.length, indexName };
}

export class Indexer {
	private client: SearchClient;
	private verbose: boolean;

	constructor(client?: SearchClient, verbose = false) {
		this.client = client ?? createSearchClient();
		this.verbose = verbose;
	}

	async index(dirPath: string): Promise<IndexResult> {
		return indexDirectory(dirPath, this.client, this.verbose);
	}

	deriveIndexName(dirPath: string): string {
		return deriveIndexName(dirPath);
	}
}
