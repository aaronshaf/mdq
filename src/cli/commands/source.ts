import fs from 'node:fs';
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
	options: {
		name?: string;
		desc?: string;
	};
}

export function runSourceAddCommand(args: SourceCommandArgs): void {
	const sourceArg = args.positional[0];

	if (!sourceArg) {
		console.error('Error: Path is required');
		console.error('Usage: md source add <path> [--desc <description>]');
		console.error('       md source add name:path [--desc <description>]');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	// Parse the source argument (handles name:path and path|description syntax)
	const parsed = parseSourceArg(sourceArg);

	// CLI flags override inline syntax
	const name = args.options.name?.toLowerCase() ?? parsed.name;
	const description = args.options.desc ?? parsed.description;
	const resolvedPath = parsed.path;

	// Validate name
	if (!name || name.trim().length === 0) {
		console.error('Error: Source name cannot be empty');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	// Validate path exists
	if (!fs.existsSync(resolvedPath)) {
		console.error(`Error: Path does not exist: ${resolvedPath}`);
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	// Validate path is a directory
	const stats = fs.statSync(resolvedPath);
	if (!stats.isDirectory()) {
		console.error(`Error: Path is not a directory: ${resolvedPath}`);
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	const source: SourceConfig = {
		name,
		path: resolvedPath,
	};

	if (description) {
		source.description = description;
	}

	try {
		addSource(source);
		console.log(`Added source "${name}" -> ${resolvedPath}`);
		if (source.description) {
			console.log(`  Description: ${source.description}`);
		}
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(EXIT_CODES.INVALID_ARGS);
	}
}

export function runSourceListCommand(): void {
	const sources = listSources();

	if (sources.length === 0) {
		console.log('No sources registered.');
		console.log('');
		console.log('Add sources with:');
		console.log('  md source add <path> [--name <name>] [--desc <description>]');
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
		console.error('Usage: md source remove <name>');
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
			console.error('  md source add <path>     Add a source');
			console.error('  md source list           List all sources');
			console.error('  md source remove <name>  Remove a source');
			process.exit(EXIT_CODES.INVALID_ARGS);
	}
}
