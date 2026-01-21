import os from 'node:os';
import path from 'node:path';
import { Glob } from 'bun';
import { parseMarkdownFile } from '../markdown/index.js';
import { type SearchClient, createSearchClient } from './client.js';
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

export async function scanMarkdownFiles(basePath: string): Promise<string[]> {
	const absoluteBase = path.resolve(basePath);
	const glob = new Glob('**/*.md');
	const files: string[] = [];

	for await (const file of glob.scan({ cwd: absoluteBase, absolute: true })) {
		if (!shouldExclude(file, absoluteBase)) {
			files.push(file);
		}
	}

	return files;
}

async function parseFileToDocument(file: string, basePath: string): Promise<SearchDocument | null> {
	try {
		const parsed = await parseMarkdownFile(file, basePath);
		const stat = await Bun.file(file).stat();

		return {
			id: parsed.id,
			title: parsed.title,
			content: parsed.content,
			path: parsed.path,
			labels: parsed.frontmatter.labels,
			author_email: parsed.frontmatter.author_email,
			created_at: stat ? stat.birthtime.getTime() : undefined,
			updated_at: stat ? stat.mtime.getTime() : undefined,
		};
	} catch {
		return null;
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
		const doc = await parseFileToDocument(file, basePath);
		if (doc) {
			documents.push(doc);
		} else {
			errors++;
			if (verbose) {
				console.error(`Error parsing ${file}`);
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

	const files = await scanMarkdownFiles(absolutePath);
	if (verbose) console.error(`Found ${files.length} markdown files`);

	if (verbose) console.error(`Recreating index: ${indexName}`);
	await searchClient.deleteIndex(indexName);
	await searchClient.createIndex(indexName);

	const { documents, errors } = await parseAllFiles(files, absolutePath, verbose);

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
