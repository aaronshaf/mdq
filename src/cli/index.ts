import { EXIT_CODES, type MdError, getExitCode } from '../lib/errors.js';
import { getFormatter } from '../lib/formatters.js';
import { parseSources } from '../lib/mcp/sources.js';
import { runEmbedCommand, runEmbedStatusCommand } from './commands/embed.js';
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
		// Smart-index options
		batchSize?: number;
		timeLimitMinutes?: number;
		reset: boolean;
		dryRun: boolean;
		// HTTP mode options
		http: boolean;
		noAuth: boolean;
		port?: number;
		host?: string;
		apiKey?: string;
	};
}

type BooleanFlag =
	| 'help'
	| 'version'
	| 'verbose'
	| 'json'
	| 'xml'
	| 'reset'
	| 'dryRun'
	| 'http'
	| 'noAuth';
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
	| 'sort'
	| 'host'
	| 'apiKey';

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
	'--reset': 'reset',
	'--dry-run': 'dryRun',
	'--http': 'http',
	'--no-auth': 'noAuth',
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
	'--host': 'host',
	'--api-key': 'apiKey',
};

function handlePositionalArg(result: ParsedArgs, arg: string): void {
	if (!result.command) {
		result.command = arg;
	} else if (!result.subcommand && result.command === 'search' && arg === 'status') {
		result.subcommand = arg;
	} else if (!result.subcommand && result.command === 'embed' && arg === 'status') {
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

	if (arg === '--batch-size' && nextArg !== undefined) {
		const batchSize = Number.parseInt(nextArg, 10);
		if (Number.isNaN(batchSize) || batchSize < 1 || batchSize > 1000) {
			console.error('Error: --batch-size must be a number between 1 and 1000');
			process.exit(EXIT_CODES.INVALID_ARGS);
		}
		options.batchSize = batchSize;
		return 2;
	}

	if (arg === '--time-limit' && nextArg !== undefined) {
		const timeLimit = Number.parseInt(nextArg, 10);
		if (Number.isNaN(timeLimit) || timeLimit < 1 || timeLimit > 1440) {
			console.error('Error: --time-limit must be a number between 1 and 1440 (minutes)');
			process.exit(EXIT_CODES.INVALID_ARGS);
		}
		options.timeLimitMinutes = timeLimit;
		return 2;
	}

	if (arg === '--port' && nextArg !== undefined) {
		const port = Number.parseInt(nextArg, 10);
		if (Number.isNaN(port) || port < 1 || port > 65535) {
			console.error('Error: --port must be a number between 1 and 65535');
			process.exit(EXIT_CODES.INVALID_ARGS);
		}
		options.port = port;
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
			reset: false,
			dryRun: false,
			http: false,
			noAuth: false,
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

function printHelp(command?: string): void {
	switch (command) {
		case 'status':
			console.log(`md status - Check if Meilisearch is running

USAGE:
  md status [options]

OPTIONS:
  --json             Output in JSON format
  --xml              Output in XML format

EXAMPLES:
  md status
  md status --json
`);
			break;

		case 'search':
			console.log(`md search - Search indexed markdown content

USAGE:
  md search <query> [options]
  md search status    Check index status

OPTIONS:
  --path <dir>             Directory to search (default: current directory)
  --limit <n>              Maximum results to return (default: 10)
  --labels <list>          Filter by labels (comma-separated, OR logic)
  --author <email>         Filter by author email
  --created-after <date>   Filter: created after date (YYYY-MM-DD)
  --created-before <date>  Filter: created before date (YYYY-MM-DD)
  --created-within <dur>   Filter: created within duration (e.g., 30d, 2w, 3m, 1y)
  --updated-after <date>   Filter: updated after date (YYYY-MM-DD)
  --updated-before <date>  Filter: updated before date (YYYY-MM-DD)
  --updated-within <dur>   Filter: updated within duration (e.g., 7d, 2w, 1m)
  --stale <dur>            Filter: NOT updated within duration (find stale content)
  --sort <field>           Sort order: created_at, -created_at, updated_at, -updated_at
  --json                   Output in JSON format
  --xml                    Output in XML format

EXAMPLES:
  md search "authentication"
  md search "" --labels api,docs --limit 5
  md search "old" --stale 90d
  md search status
`);
			break;

		case 'index':
			console.log(`md index - Build/rebuild the search index

USAGE:
  md index [options]

OPTIONS:
  --path <dir>       Directory to index (default: current directory)
  --verbose          Enable verbose output
  --json             Output in JSON format
  --xml              Output in XML format

EXAMPLES:
  md index
  md index --path ~/docs
  md index --path ~/docs --verbose
`);
			break;

		case 'embed':
			console.log(`md embed - Generate embeddings for semantic search

USAGE:
  md embed [options]
  md embed status    Check embedding service and Meilisearch connectivity

OPTIONS:
  --path <dir>         Directory to process (default: current directory)
  --batch-size <n>     Max documents to process per run (default: unlimited)
  --time-limit <min>   Max time to run in minutes (default: unlimited)
  --reset              Reset and reprocess all documents from scratch
  --dry-run            Show what would be processed without making changes
  --verbose            Enable verbose output
  --json               Output in JSON format
  --xml                Output in XML format

NOTES:
  - Documents are chunked and each chunk is embedded for semantic search
  - Without --batch-size or --time-limit, processes all remaining documents
  - With either limit, stops when limit reached or no more work to do
  - Automatically detects which documents need embedding

EXAMPLES:
  md embed --path ~/docs --verbose
  md embed --path ~/docs --batch-size 50 --verbose
  md embed --path ~/docs --time-limit 5 --verbose
  md embed --path ~/docs --reset --verbose
  md embed status
`);
			break;

		case 'mcp':
			console.log(`md mcp - Start MCP server for AI assistant integration

USAGE:
  md mcp [sources...] [options]

SOURCE FORMATS:
  ~/docs                           Single directory
  ~/docs ~/wiki ~/notes            Multiple directories
  -s <path> -d <description>       Directory with description
  name:~/path                      Named directory

OPTIONS:
  -s, --source <path>      Add a source directory (can use name:path format)
  -d, --desc <text>        Description for the preceding source

HTTP MODE OPTIONS:
  --http                   Enable HTTP transport (for remote access)
  --port <number>          Port to bind (default: 3000)
  --host <string>          Host to bind (default: 127.0.0.1)
  --api-key <string>       API key for authentication (or set MD_MCP_API_KEY)
  --no-auth                Disable authentication (for testing only)

EXAMPLES:
  md mcp ~/docs
  md mcp ~/docs ~/wiki ~/notes
  md mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

  # HTTP mode for remote access
  export MD_MCP_API_KEY="your-secret-key-here"
  md mcp --http ~/docs
  md mcp --http --port 8080 --host 0.0.0.0 ~/docs
`);
			break;

		default:
			console.log(`md - Markdown file indexer and search CLI

USAGE:
  md <command> [options]

COMMANDS:
  status             Check if Meilisearch is running
  search <query>     Search indexed markdown content
  search status      Check Meilisearch connection and index status
  index              Build/rebuild the search index
  embed              Generate embeddings for semantic search
  embed status       Check embedding service and Meilisearch connectivity
  mcp [sources...]   Start MCP server for AI assistant integration

GLOBAL OPTIONS:
  -h, --help         Show this help message
  -v, --version      Show version number

Run "md <command> --help" for command-specific help.

EXAMPLES:
  md status
  md search "authentication"
  md index --path ~/docs
  md embed --path ~/docs --verbose
  md mcp ~/docs
`);
	}
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

	if (parsed.options.help) {
		printHelp(parsed.command || undefined);
		process.exit(EXIT_CODES.SUCCESS);
	}

	if (!parsed.command) {
		printHelp();
		process.exit(EXIT_CODES.INVALID_ARGS);
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

			case 'index': {
				const result = await runSearchIndexCommand(basePath, parsed.options.verbose);
				console.log(formatter.format(result));
				break;
			}

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

				// Handle HTTP mode options
				let httpOptions:
					| {
							enabled: boolean;
							port: number;
							host: string;
							apiKey: string;
							noAuth: boolean;
					  }
					| undefined;

				if (parsed.options.http) {
					// Get API key from flag or environment
					const apiKey = parsed.options.apiKey ?? process.env.MD_MCP_API_KEY ?? '';

					// Get port from flag, environment, or default
					const port =
						parsed.options.port ??
						(process.env.MD_MCP_PORT ? Number.parseInt(process.env.MD_MCP_PORT, 10) : 3000);

					// Get host from flag, environment, or default (localhost-only)
					const host = parsed.options.host ?? process.env.MD_MCP_HOST ?? '127.0.0.1';

					httpOptions = {
						enabled: true,
						port,
						host,
						apiKey,
						noAuth: parsed.options.noAuth,
					};
				}

				await runMcpCommand(sources, httpOptions);
				break;
			}

			case 'embed': {
				if (parsed.subcommand === 'status') {
					const result = await runEmbedStatusCommand(basePath);
					console.log(formatter.format(result));
					if (!result.meiliHealthy || !result.embeddingHealthy) {
						process.exit(EXIT_CODES.CONNECTION_ERROR);
					}
					break;
				}

				const result = await runEmbedCommand(basePath, {
					batchSize: parsed.options.batchSize,
					timeLimitMinutes: parsed.options.timeLimitMinutes,
					reset: parsed.options.reset,
					dryRun: parsed.options.dryRun,
					verbose: parsed.options.verbose,
				});

				// Always output result summary
				console.log(formatter.format(result));
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
