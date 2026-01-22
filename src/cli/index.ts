import { EXIT_CODES, type MdError, getExitCode } from '../lib/errors.js';
import { getFormatter } from '../lib/formatters.js';
import { parseSources } from '../lib/mcp/sources.js';
import { runMcpCommand } from './commands/mcp.js';
import {
	runSearchCommand,
	runSearchIndexCommand,
	runSearchStatusCommand,
	runStatusCommand,
} from './commands/search.js';

// Read version at module load time - Bun resolves JSON imports synchronously
import packageJson from '../../package.json';
const VERSION = packageJson.version;

interface McpSourceArg {
	source: string;
	desc?: string;
}

interface ParsedArgs {
	command: string;
	subcommand?: string;
	positional: string[];
	mcpSources: McpSourceArg[];
	options: {
		help: boolean;
		version: boolean;
		verbose: boolean;
		json: boolean;
		xml: boolean;
		path?: string;
		limit?: number;
		labels?: string[];
		author?: string;
		createdAfter?: string;
		createdBefore?: string;
		createdWithin?: string;
		updatedAfter?: string;
		updatedBefore?: string;
		updatedWithin?: string;
		stale?: string;
		sort?: SortValue;
	};
}

type BooleanFlag = 'help' | 'version' | 'verbose' | 'json' | 'xml';
type StringFlag =
	| 'path'
	| 'author'
	| 'createdAfter'
	| 'createdBefore'
	| 'createdWithin'
	| 'updatedAfter'
	| 'updatedBefore'
	| 'updatedWithin'
	| 'stale'
	| 'sort';

type SortValue = 'created_at' | '-created_at' | 'updated_at' | '-updated_at';
const VALID_SORT_VALUES = new Set<string>([
	'created_at',
	'-created_at',
	'updated_at',
	'-updated_at',
]);

const BOOLEAN_FLAGS: Record<string, BooleanFlag> = {
	'--help': 'help',
	'-h': 'help',
	'--version': 'version',
	'-v': 'version',
	'--verbose': 'verbose',
	'--json': 'json',
	'--xml': 'xml',
};

const STRING_FLAGS: Record<string, StringFlag> = {
	'--path': 'path',
	'--author': 'author',
	'--created-after': 'createdAfter',
	'--created-before': 'createdBefore',
	'--created-within': 'createdWithin',
	'--updated-after': 'updatedAfter',
	'--updated-before': 'updatedBefore',
	'--updated-within': 'updatedWithin',
	'--stale': 'stale',
};

function handlePositionalArg(result: ParsedArgs, arg: string): void {
	if (!result.command) {
		result.command = arg;
	} else if (
		!result.subcommand &&
		result.command === 'search' &&
		(arg === 'index' || arg === 'status')
	) {
		result.subcommand = arg;
	} else {
		result.positional.push(arg);
	}
}

interface ParseResult {
	parsed: ParsedArgs;
	unknownFlags: string[];
}

function tryParseFlag(
	arg: string,
	nextArg: string | undefined,
	options: ParsedArgs['options'],
): number {
	const boolFlag = BOOLEAN_FLAGS[arg];
	if (boolFlag) {
		options[boolFlag] = true;
		return 1;
	}

	const strFlag = STRING_FLAGS[arg];
	if (strFlag && nextArg !== undefined) {
		// All StringFlag keys map to string | undefined in options
		(options as Record<StringFlag, string | undefined>)[strFlag] = nextArg;
		return 2;
	}

	if (arg === '--limit' && nextArg !== undefined) {
		const limit = Number.parseInt(nextArg, 10);
		if (Number.isNaN(limit) || limit < 1 || limit > 100) {
			console.error('Error: --limit must be a number between 1 and 100');
			process.exit(EXIT_CODES.INVALID_ARGS);
		}
		options.limit = limit;
		return 2;
	}

	if (arg === '--labels' && nextArg !== undefined) {
		options.labels = options.labels ?? [];
		options.labels.push(...nextArg.split(',').map((l) => l.trim()));
		return 2;
	}

	if (arg === '--sort' && nextArg !== undefined) {
		if (!VALID_SORT_VALUES.has(nextArg)) {
			console.error(
				'Error: --sort must be one of: created_at, -created_at, updated_at, -updated_at',
			);
			process.exit(EXIT_CODES.INVALID_ARGS);
		}
		options.sort = nextArg as SortValue;
		return 2;
	}

	return 0;
}

function parseArgs(args: string[]): ParseResult {
	const result: ParsedArgs = {
		command: '',
		positional: [],
		mcpSources: [],
		options: {
			help: false,
			version: false,
			verbose: false,
			json: false,
			xml: false,
		},
	};
	const unknownFlags: string[] = [];

	let i = 0;
	while (i < args.length) {
		const arg = args[i]!;
		const consumed = tryParseFlag(arg, args[i + 1], result.options);

		if (consumed > 0) {
			i += consumed;
			continue;
		}

		// Handle MCP source flags: -s/--source and -d/--desc
		if (arg === '-s' || arg === '--source') {
			const value = args[i + 1];
			if (!value || value.startsWith('-')) {
				console.error('Error: -s/--source requires a path argument');
				process.exit(EXIT_CODES.INVALID_ARGS);
			}
			result.mcpSources.push({ source: value });
			i += 2;
			continue;
		}

		if (arg === '-d' || arg === '--desc') {
			const value = args[i + 1];
			if (!value) {
				console.error('Error: -d/--desc requires a description argument');
				process.exit(EXIT_CODES.INVALID_ARGS);
			}
			// Attach description to the most recent source
			const lastSource = result.mcpSources[result.mcpSources.length - 1];
			if (lastSource) {
				lastSource.desc = value;
			} else {
				console.error('Error: -d/--desc must follow a -s/--source flag');
				process.exit(EXIT_CODES.INVALID_ARGS);
			}
			i += 2;
			continue;
		}

		if (arg.startsWith('-')) {
			unknownFlags.push(arg);
		} else {
			handlePositionalArg(result, arg);
		}

		i++;
	}

	return { parsed: result, unknownFlags };
}

function printHelp(): void {
	console.log(`md - Markdown file indexer and search CLI

USAGE:
  md <command> [options]

COMMANDS:
  status             Check if Meilisearch is running
  search <query>     Search indexed markdown content
  search index       Build/rebuild the search index
  search status      Check Meilisearch connection and index status
  mcp [sources...]   Start MCP server for AI assistant integration

GLOBAL OPTIONS:
  -h, --help         Show this help message
  -v, --version      Show version number
  --verbose          Enable verbose output
  --json             Output in JSON format
  --xml              Output in XML format
  --path <dir>       Directory to search/index (default: current directory)

SEARCH OPTIONS:
  --limit <n>        Maximum results to return (default: 10)
  --labels <list>    Filter by labels (comma-separated, OR logic)
  --author <email>   Filter by author email
  --created-after <date>   Filter: created after date (YYYY-MM-DD)
  --created-before <date>  Filter: created before date (YYYY-MM-DD)
  --created-within <dur>   Filter: created within duration (e.g., 30d, 2w, 3m, 1y)
  --updated-after <date>   Filter: updated after date (YYYY-MM-DD)
  --updated-before <date>  Filter: updated before date (YYYY-MM-DD)
  --updated-within <dur>   Filter: updated within duration (e.g., 7d, 2w, 1m)
  --stale <dur>            Filter: NOT updated within duration (find stale content)
  --sort <field>           Sort order: created_at, -created_at, updated_at, -updated_at

MCP OPTIONS:
  -s, --source <path>      Add a source directory (can use name:path format)
  -d, --desc <text>        Description for the preceding source (helps AI know when to search)

EXAMPLES:
  md status
  md search "authentication"
  md search "" --labels api,docs --limit 5
  md search "old" --stale 90d
  md search index --path ~/docs
  md search status
  md mcp ~/docs
  md mcp ~/docs ~/wiki ~/notes
  md mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"
  md mcp -s notes:~/notes -d "Journal" -s eng:~/docs/eng -d "Engineering docs"
`);
}

function printVersion(): void {
	console.log(`md version ${VERSION}`);
}

function getOutputFormat(options: ParsedArgs['options']): 'human' | 'json' | 'xml' {
	if (options.json) return 'json';
	if (options.xml) return 'xml';
	return 'human';
}

async function handleSearchCommand(
	parsed: ParsedArgs,
	basePath: string,
	formatter: ReturnType<typeof getFormatter>,
): Promise<void> {
	if (parsed.subcommand === 'index') {
		const result = await runSearchIndexCommand(basePath, parsed.options.verbose);
		console.log(formatter.format(result));
		return;
	}

	if (parsed.subcommand === 'status') {
		const result = await runSearchStatusCommand(basePath);
		console.log(formatter.format(result));
		return;
	}

	const query = parsed.positional[0] ?? '';
	const result = await runSearchCommand(basePath, {
		query,
		limit: parsed.options.limit,
		labels: parsed.options.labels,
		author: parsed.options.author,
		createdAfter: parsed.options.createdAfter,
		createdBefore: parsed.options.createdBefore,
		createdWithin: parsed.options.createdWithin,
		updatedAfter: parsed.options.updatedAfter,
		updatedBefore: parsed.options.updatedBefore,
		updatedWithin: parsed.options.updatedWithin,
		stale: parsed.options.stale,
		sort: parsed.options.sort,
	});
	console.log(formatter.format(result.results));
}

function handleError(error: unknown, formatter: ReturnType<typeof getFormatter>): never {
	if (error && typeof error === 'object' && '_tag' in error) {
		const mdError = error as MdError;
		console.error(formatter.formatError({ message: mdError.message }));
		process.exit(getExitCode(mdError));
	}

	console.error(formatter.formatError(error instanceof Error ? error : { message: String(error) }));
	process.exit(EXIT_CODES.GENERAL_ERROR);
}

export async function run(args: string[]): Promise<void> {
	const { parsed, unknownFlags } = parseArgs(args);

	if (parsed.options.version) {
		printVersion();
		process.exit(EXIT_CODES.SUCCESS);
	}

	if (parsed.options.help || !parsed.command) {
		printHelp();
		process.exit(parsed.options.help ? EXIT_CODES.SUCCESS : EXIT_CODES.INVALID_ARGS);
	}

	// Warn about unknown flags
	if (unknownFlags.length > 0) {
		console.error(`Warning: Unknown flag(s): ${unknownFlags.join(', ')}`);
	}

	const formatter = getFormatter(getOutputFormat(parsed.options));
	const basePath = parsed.options.path ?? process.cwd();

	try {
		switch (parsed.command) {
			case 'status': {
				const result = await runStatusCommand();
				console.log(formatter.format(result));
				if (!result.healthy) {
					process.exit(EXIT_CODES.CONNECTION_ERROR);
				}
				break;
			}

			case 'search':
				await handleSearchCommand(parsed, basePath, formatter);
				break;

			case 'mcp': {
				// Build source args from -s/-d flags and positional args
				// Flag-based sources: -s path -d "description"
				// Positional sources: path or name:path or "name:path|description"
				const sourceArgs: string[] = [];

				// Add flag-based sources (convert to "path|description" format)
				for (const { source, desc } of parsed.mcpSources) {
					sourceArgs.push(desc ? `${source}|${desc}` : source);
				}

				// Add positional sources
				sourceArgs.push(...parsed.positional);

				// Default to cwd if no sources specified
				const finalSourceArgs = sourceArgs.length > 0 ? sourceArgs : [basePath];
				const { sources, errors } = parseSources(finalSourceArgs);

				if (errors.length > 0) {
					for (const error of errors) {
						console.error(`Error: ${error}`);
					}
					process.exit(EXIT_CODES.INVALID_ARGS);
				}

				if (sources.length === 0) {
					console.error('Error: No valid sources provided');
					process.exit(EXIT_CODES.INVALID_ARGS);
				}

				await runMcpCommand(sources);
				break;
			}

			default:
				console.error(formatter.formatError({ message: `Unknown command: ${parsed.command}` }));
				printHelp();
				process.exit(EXIT_CODES.INVALID_ARGS);
		}
	} catch (error) {
		handleError(error, formatter);
	}
}
