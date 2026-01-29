import fs from 'node:fs';
import path from 'node:path';
import {
	type SourceConfig,
	addSource,
	listSources,
	removeSource,
} from '../../lib/config/sources.js';
import { EXIT_CODES } from '../../lib/errors.js';
import { parseSourceArg } from '../../lib/mcp/sources.js';

export interface SourceCommandArgs {
	subcommand: string;
	positional: string[];
	mcpSources: Array<{ source: string; desc?: string }>;
}

/**
 * Directories to skip when expanding glob patterns.
 * These are common build/dependency directories that shouldn't be added as sources.
 */
const SKIP_DIRECTORIES = new Set([
	'node_modules',
	'.git',
	'.github',
	'.vscode',
	'.idea',
	'dist',
	'build',
	'out',
	'target',
	'coverage',
	'.next',
	'.nuxt',
	'.cache',
	'__pycache__',
	'.pytest_cache',
	'.DS_Store',
]);

/**
 * Expand a glob pattern to matching directories.
 * Currently supports `*` for all immediate subdirectories in the current directory.
 *
 * Returns empty array for unsupported patterns, allowing them to be treated as literal paths.
 * This enables fallback behavior:
 * - `*` → expands to subdirectories
 * - `foo*` → returns [] → treated as literal path "foo*"
 * - `**` → returns [] → treated as literal path "**"
 *
 * @param pattern - The glob pattern (e.g., "*")
 * @param basePath - The base directory to search in (defaults to cwd)
 * @returns Array of absolute directory paths (empty if pattern not supported)
 */
function expandGlobPattern(pattern: string, basePath = process.cwd()): string[] {
	// Currently only support "*" for immediate subdirectories
	// Return empty array for other patterns to enable fallback to literal path handling
	if (pattern !== '*') {
		return [];
	}

	const directories: string[] = [];

	try {
		const entries = fs.readdirSync(basePath, { withFileTypes: true });

		for (const entry of entries) {
			// Skip if not a directory
			// Note: isDirectory() returns true for symlinks pointing to directories
			if (!entry.isDirectory()) {
				continue;
			}

			// Skip hidden directories (starting with .)
			if (entry.name.startsWith('.')) {
				continue;
			}

			// Skip common ignore patterns
			if (SKIP_DIRECTORIES.has(entry.name)) {
				continue;
			}

			const fullPath = path.join(basePath, entry.name);
			directories.push(fullPath);
		}
	} catch (error) {
		// If we can't read the directory, return empty array
		console.error(`Warning: Could not read directory "${basePath}" (check permissions)`);
	}

	return directories;
}

/**
 * Add a single source with validation and optional description lookup.
 *
 * @param resolvedPath - The resolved absolute path to the directory
 * @param description - Optional description
 * @param name - Optional explicit name (if not provided, derived from path)
 */
function addSingleSource(resolvedPath: string, description?: string, name?: string): void {
	// Validate path exists
	if (!fs.existsSync(resolvedPath)) {
		throw new Error(`Path does not exist: ${resolvedPath}`);
	}

	// Validate path is a directory
	const stats = fs.statSync(resolvedPath);
	if (!stats.isDirectory()) {
		throw new Error(`Path is not a directory: ${resolvedPath}`);
	}

	// Derive name if not provided
	let sourceName = name;
	if (!sourceName) {
		const parsed = parseSourceArg(resolvedPath);
		sourceName = parsed.name;
	}

	// Validate name
	if (!sourceName || sourceName.trim().length === 0) {
		throw new Error('Source name cannot be empty');
	}

	// If no description provided, check for .confluence.json
	let sourceDescription = description;
	if (!sourceDescription) {
		const confluenceJsonPath = path.join(resolvedPath, '.confluence.json');
		if (fs.existsSync(confluenceJsonPath)) {
			try {
				const confluenceJson = JSON.parse(fs.readFileSync(confluenceJsonPath, 'utf-8'));
				const spaceName = confluenceJson.spaceName;
				if (typeof spaceName === 'string' && spaceName.trim()) {
					sourceDescription = spaceName.trim();
				}
			} catch {
				// Silently ignore if we can't read or parse .confluence.json
			}
		}
	}

	const source: SourceConfig = {
		name: sourceName,
		path: resolvedPath,
	};

	if (sourceDescription) {
		source.description = sourceDescription;
	}

	addSource(source);
	console.log(`Added source "${sourceName}" -> ${resolvedPath}`);
	if (source.description) {
		console.log(`  Description: ${source.description}`);
	}
}

export function runSourceAddCommand(args: SourceCommandArgs): void {
	// Collect all source paths from both positional args and -s flags
	const sourcePaths: string[] = [];

	// Add positional arguments (e.g., from `mdq source add DIR1 DIR2` or `mdq source add *`)
	if (args.positional.length > 0) {
		sourcePaths.push(...args.positional);
	}

	// Add -s flag arguments
	if (args.mcpSources.length > 0) {
		sourcePaths.push(...args.mcpSources.map((s) => s.source));
	}

	if (sourcePaths.length === 0) {
		console.error('Error: Source path is required');
		console.error('Usage: mdq source add <path>...');
		console.error('       mdq source add -s <path> [-d <description>]');
		console.error('       mdq source add -s name:path [-d <description>]');
		console.error('       mdq source add DIR1 DIR2 DIR3  (multiple directories)');
		console.error('       mdq source add *  (all subdirectories, expands via shell)');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	// Get global description from first -s flag if provided (for positional args)
	const globalDescription = args.mcpSources.length > 0 ? args.mcpSources[0]?.desc : undefined;

	// Handle multiple sources (or glob patterns that might expand)
	if (sourcePaths.length >= 1) {
		let addedCount = 0;
		const errors: string[] = [];

		for (const sourcePath of sourcePaths) {
			try {
				// Check if this is a glob pattern (unexpanded "*")
				const expandedPaths = expandGlobPattern(sourcePath);

				// If glob pattern, expand it
				if (expandedPaths.length > 0) {
					for (const dirPath of expandedPaths) {
						try {
							addSingleSource(dirPath, globalDescription);
							addedCount++;
						} catch (error) {
							errors.push(
								`  ${dirPath}: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					}
				} else {
					// Not a glob, add as single source
					const parsed = parseSourceArg(sourcePath);
					addSingleSource(parsed.path, globalDescription ?? parsed.description, parsed.name);
					addedCount++;
				}
			} catch (error) {
				errors.push(`  ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		// Only show summary if:
		// 1. Multiple source paths were provided, OR
		// 2. A single glob expanded to multiple directories (addedCount > 1), OR
		// 3. There were errors
		const shouldShowSummary = sourcePaths.length > 1 || addedCount > 1 || errors.length > 0;

		if (shouldShowSummary) {
			console.log(`\nAdded ${addedCount} source(s)`);
			if (errors.length > 0) {
				console.error('\nErrors:');
				for (const error of errors) {
					console.error(error);
				}
			}
		}
		return;
	}
}

export function runSourceListCommand(): void {
	const sources = listSources();

	if (sources.length === 0) {
		console.log('No sources registered.');
		console.log('');
		console.log('Add sources with:');
		console.log('  mdq source add <path> [--name <name>] [--desc <description>]');
		return;
	}

	// Calculate column widths
	const nameWidth = Math.max(4, ...sources.map((s) => s.name.length));
	const pathWidth = Math.max(4, ...sources.map((s) => s.path.length));

	// Print header
	console.log(`${'NAME'.padEnd(nameWidth)}  ${'PATH'.padEnd(pathWidth)}  DESCRIPTION`);
	console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(pathWidth)}  -----------`);

	// Print sources
	for (const source of sources) {
		const desc = source.description ?? '';
		console.log(`${source.name.padEnd(nameWidth)}  ${source.path.padEnd(pathWidth)}  ${desc}`);
	}
}

export function runSourceRemoveCommand(args: SourceCommandArgs): void {
	const name = args.positional[0];

	if (!name) {
		console.error('Error: Source name is required');
		console.error('Usage: mdq source remove <name>');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	const removed = removeSource(name);

	if (!removed) {
		console.error(`Error: No source found with name "${name}"`);
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	console.log(`Removed source "${name}"`);
}

export function runSourceCommand(args: SourceCommandArgs): void {
	switch (args.subcommand) {
		case 'add':
			runSourceAddCommand(args);
			break;
		case 'list':
			runSourceListCommand();
			break;
		case 'remove':
			runSourceRemoveCommand(args);
			break;
		default:
			console.error(`Unknown source subcommand: ${args.subcommand}`);
			console.error('');
			console.error('Available subcommands:');
			console.error('  mdq source add <path>     Add a source');
			console.error('  mdq source list           List all sources');
			console.error('  mdq source remove <name>  Remove a source');
			process.exit(EXIT_CODES.INVALID_ARGS);
	}
}
