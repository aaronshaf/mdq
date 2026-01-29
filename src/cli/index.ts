import fs from 'node:fs';
import { type SourceConfig, listSources as listRegisteredSources } from '../lib/config/sources.js';
import { EXIT_CODES, type MdError, getExitCode } from '../lib/errors.js';
import { getFormatter } from '../lib/formatters.js';
import { type Source, parseSources } from '../lib/mcp/sources.js';
import type { SearchResponse } from '../lib/search/index.js';
import { runEmbedCommand, runEmbedStatusCommand } from './commands/embed.js';
import { runMcpCommand } from './commands/mcp.js';
import { type OAuthCommandArgs, runOAuthCommand } from './commands/oauth.js';
import {
	runSearchCommand,
	runSearchIndexCommand,
	runSearchMultipleCommand,
	runSearchStatusCommand,
	runStatusCommand,
} from './commands/search.js';
import { type SourceCommandArgs, runSourceCommand } from './commands/source.js';

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
		printConfig: boolean;
		port?: number;
		host?: string;
		apiKey?: string;
		oauth: boolean;
		cert?: string;
		key?: string;
		// Source command options
		name?: string;
		description?: string;
		// OAuth command options
		clientId?: string;
		redirectUri?: string;
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
	| 'noAuth'
	| 'printConfig'
	| 'oauth';
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
	| 'apiKey'
	| 'name'
	| 'description'
	| 'cert'
	| 'key'
	| 'clientId'
	| 'redirectUri';

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
	'--print-config': 'printConfig',
	'--oauth': 'oauth',
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
	'--name': 'name',
	'-d': 'description',
	'--desc': 'description',
	'--description': 'description',
	'--cert': 'cert',
	'--key': 'key',
	'--client-id': 'clientId',
	'--redirect-uri': 'redirectUri',
};

function handlePositionalArg(result: ParsedArgs, arg: string): void {
	if (!result.command) {
		result.command = arg;
	} else if (!result.subcommand && result.command === 'search' && arg === 'status') {
		result.subcommand = arg;
	} else if (!result.subcommand && result.command === 'embed' && arg === 'status') {
		result.subcommand = arg;
	} else if (
		!result.subcommand &&
		result.command === 'source' &&
		['add', 'list', 'remove'].includes(arg)
	) {
		result.subcommand = arg;
	} else if (
		!result.subcommand &&
		result.command === 'oauth' &&
		['setup', 'list', 'remove', 'status'].includes(arg)
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
			printConfig: false,
			oauth: false,
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
			console.log(`mdq status - Check if Meilisearch is running

USAGE:
  mdq status [options]

OPTIONS:
  --json             Output in JSON format
  --xml              Output in XML format

EXAMPLES:
  mdq status
  mdq status --json
`);
			break;

		case 'search':
			console.log(`mdq search - Search indexed markdown content

USAGE:
  mdq search <query> [options]
  mdq search status    Check index status

OPTIONS:
  --path <dir>             Directory to search (if not specified, searches all registered sources)
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

NOTES:
  By default, searches all registered sources. Use --path to search a specific directory.
  Use 'mdq source list' to see registered sources.

EXAMPLES:
  mdq search "authentication"                  # searches all registered sources
  mdq search "authentication" --path ~/docs    # searches specific directory
  mdq search "" --labels api,docs --limit 5
  mdq search "old" --stale 90d
  mdq search status
`);
			break;

		case 'index':
			console.log(`mdq index - Build/rebuild the search index

USAGE:
  mdq index [options]

OPTIONS:
  --path <dir>       Directory to index (if not specified, indexes all registered sources)
  --verbose          Enable verbose output
  --json             Output in JSON format
  --xml              Output in XML format

EXAMPLES:
  mdq index                      # Index all registered sources
  mdq index --path ~/docs        # Index specific directory
  mdq index --verbose            # Index all sources with verbose output
`);
			break;

		case 'embed':
			console.log(`mdq embed - Generate embeddings for semantic search

USAGE:
  mdq embed [options]
  mdq embed status    Check embedding service and Meilisearch connectivity

OPTIONS:
  --path <dir>         Directory to process (if not specified, embeds all registered sources)
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
  mdq embed                           # Embed all registered sources
  mdq embed --path ~/docs --verbose   # Embed specific directory
  mdq embed --batch-size 50           # Limit to 50 documents per source
  mdq embed --reset                   # Reprocess all documents
  mdq embed status
`);
			break;

		case 'source':
			console.log(`mdq source - Manage registered sources for MCP server

USAGE:
  mdq source add -s <path> [-d <desc>]       Add a source directory
  mdq source add -s name:path [-d <desc>]    Add with explicit name
  mdq source list                            List all registered sources
  mdq source remove <name>                   Remove a source by name

OPTIONS (for add):
  -s <path>            Source path (required)
  -d <description>     Description of the source

NOTES:
  Registered sources are automatically loaded by 'mdq mcp' when no
  CLI sources are provided. Sources are stored in ~/.config/mdq/sources.json

EXAMPLES:
  mdq source add -s ~/docs
  mdq source add -s ~/docs -d "Documentation"
  mdq source add -s kb:~/docs -d "Knowledge base"
  mdq source list
  mdq source remove kb
`);
			break;

		case 'oauth':
			console.log(`mdq oauth - Manage OAuth 2.1 authentication for remote access

USAGE:
  mdq oauth setup [options]       Create a new OAuth client
  mdq oauth list                  List configured OAuth clients
  mdq oauth remove <client-id>    Remove an OAuth client
  mdq oauth status                Show OAuth status and tokens

OPTIONS (for setup):
  --client-id <id>         Client ID (default: auto-generated)
  --name <name>            Client name (default: "Default Client")
  --redirect-uri <uri>     Redirect URI (default: Claude.ai)

NOTES:
  OAuth 2.1 with PKCE provides secure authentication for remote access.
  HTTPS is required when OAuth is enabled (use --cert and --key flags).
  Access tokens expire after 1 hour (configurable via MDQ_OAUTH_TOKEN_EXPIRY).

EXAMPLES:
  mdq oauth setup --client-id claude --name "Claude"
  mdq oauth list
  mdq oauth status
  mdq oauth remove claude
`);
			break;

		case 'mcp':
			console.log(`mdq mcp - Start MCP server for AI assistant integration

USAGE:
  mdq mcp [sources...] [options]

SOURCE FORMATS:
  ~/docs                           Single directory
  ~/docs ~/wiki ~/notes            Multiple directories
  -s <path> -d <description>       Directory with description
  name:~/path                      Named directory

OPTIONS:
  -s, --source <path>      Add a source directory (can use name:path format)
  -d, --desc <text>        Description for the preceding source
  --print-config           Output Claude Desktop JSON config and exit

HTTP MODE OPTIONS:
  --http                   Enable HTTP transport (for remote access)
  --port <number>          Port to bind (default: 3000)
  --host <string>          Host to bind (default: 127.0.0.1)
  --api-key <string>       API key for authentication (or set MDQ_MCP_API_KEY)
  --no-auth                Disable authentication (for testing only)
  --oauth                  Enable OAuth 2.1 authentication (requires HTTPS)
  --cert <path>            TLS certificate path (for HTTPS)
  --key <path>             TLS private key path (for HTTPS)

NOTES:
  If no sources are provided, registered sources from 'mdq source add' are used.
  Use 'mdq source list' to see registered sources.
  CLI sources (-s flags) override registered sources.

EXAMPLES:
  # Local access (stdio)
  mdq mcp                        # uses registered sources
  mdq mcp ~/docs                 # uses only ~/docs (ignores registered)
  mdq mcp ~/docs ~/wiki ~/notes
  mdq mcp -s ~/notes -d "Personal journal" -s ~/wiki -d "Team docs"

  # HTTP mode with Bearer token (simple)
  export MDQ_MCP_API_KEY="$(openssl rand -hex 32)"
  mdq mcp --http ~/docs
  mdq mcp --http --port 8080 --host 0.0.0.0 ~/docs

  # HTTPS mode with OAuth 2.1 (recommended for production)
  # Step 1: Generate self-signed certificate (or use real cert)
  openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

  # Step 2: Create OAuth client
  mdq oauth setup --client-id claude --name "Claude"

  # Step 3: Start server with OAuth
  mdq mcp --http --oauth --cert ./cert.pem --key ./key.pem ~/docs

  # Step 4: Expose to internet (optional)
  cloudflared tunnel --url https://localhost:3000

  # Step 5: Connect from Claude web UI
  # Settings > Connectors > Add custom connector
  # Claude will auto-discover OAuth endpoints and guide you through authorization
`);
			break;

		default:
			console.log(`mdq - Markdown file indexer and search CLI

USAGE:
  mdq <command> [options]

COMMANDS:
  status             Check if Meilisearch is running
  search <query>     Search indexed markdown content
  search status      Check Meilisearch connection and index status
  index              Build/rebuild the search index
  embed              Generate embeddings for semantic search
  embed status       Check embedding service and Meilisearch connectivity
  source             Manage registered sources for MCP server
  oauth              Manage OAuth 2.1 authentication
  mcp [sources...]   Start MCP server for AI assistant integration

GLOBAL OPTIONS:
  -h, --help         Show this help message
  -v, --version      Show version number

Run "mdq <command> --help" for command-specific help.

EXAMPLES:
  mdq status
  mdq search "authentication"
  mdq index --path ~/docs
  mdq embed --path ~/docs --verbose
  mdq source add -s ~/docs -d "Documentation"
  mdq oauth setup --client-id claude --name "Claude"
  mdq mcp
`);
	}
}

function printVersion(): void {
	console.log(`mdq version ${VERSION}`);
}

interface McpServerConfig {
	command: string;
	args: string[];
}

interface McpConfig {
	mcpServers: {
		kb: McpServerConfig;
	};
}

function generateMcpConfig(): McpConfig {
	const execPath = process.execPath; // e.g., /Users/you/.bun/bin/bun or /usr/local/bin/node
	const scriptPath = process.argv[1] ?? ''; // e.g., /Users/you/.bun/bin/mdq

	// Detect if running via bun
	const isBun = execPath.includes('bun') || process.versions.bun !== undefined;

	if (isBun) {
		// Bun installation: use bun as command with run + script path
		return {
			mcpServers: {
				kb: {
					command: execPath,
					args: ['run', scriptPath, 'mcp'],
				},
			},
		};
	}

	// Node installation: use node as command with script path
	return {
		mcpServers: {
			kb: {
				command: execPath,
				args: [scriptPath, 'mcp'],
			},
		},
	};
}

function getOutputFormat(options: ParsedArgs['options']): 'human' | 'json' | 'xml' {
	if (options.json) return 'json';
	if (options.xml) return 'xml';
	return 'human';
}

/**
 * Validate that registered source paths exist.
 * Exits with error if no sources registered or if paths don't exist.
 */
function validateRegisteredSources(): SourceConfig[] {
	const registered = listRegisteredSources();
	if (registered.length === 0) {
		console.error('No registered sources found.');
		console.error('Either register sources with "mdq source add" or specify --path');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	// Validate that registered paths exist
	const missingPaths: string[] = [];
	for (const s of registered) {
		if (!fs.existsSync(s.path)) {
			missingPaths.push(`  ${s.name}: ${s.path}`);
		}
	}
	if (missingPaths.length > 0) {
		console.error('Some registered source paths do not exist:');
		for (const p of missingPaths) {
			console.error(p);
		}
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	return registered;
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
	const searchOptions = {
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
	};

	// If --path is specified, search only that path
	// Otherwise, search all registered sources
	let result: SearchResponse;
	if (parsed.options.path) {
		result = await runSearchCommand(basePath, searchOptions);
	} else {
		// Search all registered sources
		const registered = validateRegisteredSources();
		result = await runSearchMultipleCommand(registered, searchOptions);
	}

	// Display warnings to stderr in human mode, or include in structured output
	if (result.warnings && result.warnings.length > 0) {
		if (parsed.options.json || parsed.options.xml) {
			// Include warnings in structured output
			console.log(formatter.format(result));
		} else {
			// Display warnings to stderr in human mode
			for (const warning of result.warnings) {
				console.error(`Warning [${warning.source}]: ${warning.message}`);
			}
			console.log(formatter.format(result.results));
		}
	} else {
		console.log(formatter.format(result.results));
	}
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
				// If --path is explicitly specified, index just that path
				if (parsed.options.path) {
					const result = await runSearchIndexCommand(basePath, parsed.options.verbose);
					console.log(formatter.format(result));
				} else {
					// Otherwise, index all registered sources
					const registered = validateRegisteredSources();

					// Index each registered source
					for (const source of registered) {
						console.log(`Indexing ${source.name} (${source.path})...`);
						const result = await runSearchIndexCommand(source.path, parsed.options.verbose);
						console.log(formatter.format(result));
					}
				}
				break;
			}

			case 'source': {
				const sourceArgs: SourceCommandArgs = {
					subcommand: parsed.subcommand ?? '',
					positional: parsed.positional,
					mcpSources: parsed.mcpSources,
				};
				runSourceCommand(sourceArgs);
				break;
			}

			case 'oauth': {
				const oauthArgs: OAuthCommandArgs = {
					subcommand: parsed.subcommand ?? '',
					positional: parsed.positional,
					options: {
						clientId: parsed.options.clientId,
						name: parsed.options.name,
						redirectUri: parsed.options.redirectUri,
					},
				};
				runOAuthCommand(oauthArgs);
				break;
			}

			case 'mcp': {
				// Handle --print-config: output Claude Desktop JSON config
				if (parsed.options.printConfig) {
					const config = generateMcpConfig();
					console.log(JSON.stringify(config, null, 2));
					process.exit(EXIT_CODES.SUCCESS);
				}

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

				// Determine sources: CLI args override registered, otherwise use registered
				let sources: Source[];

				if (sourceArgs.length > 0) {
					// CLI sources provided - use those (override registered)
					const parseResult = parseSources(sourceArgs);
					if (parseResult.errors.length > 0) {
						for (const error of parseResult.errors) {
							console.error(`Error: ${error}`);
						}
						process.exit(EXIT_CODES.INVALID_ARGS);
					}
					sources = parseResult.sources;
				} else {
					// No CLI sources - try to load registered sources
					const registered = listRegisteredSources();
					if (registered.length > 0) {
						// Validate that registered paths still exist
						const missingPaths: string[] = [];
						for (const s of registered) {
							if (!fs.existsSync(s.path)) {
								missingPaths.push(`  ${s.name}: ${s.path}`);
							}
						}
						if (missingPaths.length > 0) {
							console.error('Error: Some registered source paths no longer exist:');
							for (const msg of missingPaths) {
								console.error(msg);
							}
							console.error('');
							console.error('Remove invalid sources with:');
							console.error('  mdq source remove <name>');
							process.exit(EXIT_CODES.INVALID_ARGS);
						}

						sources = registered.map((s) => ({
							name: s.name,
							path: s.path,
							description: s.description,
						}));
					} else {
						// No registered sources - show helpful error
						console.error('Error: No sources provided and no sources registered.');
						console.error('');
						console.error('Either provide sources on the command line:');
						console.error('  mdq mcp ~/docs');
						console.error('  mdq mcp -s ~/docs -d "Documentation"');
						console.error('');
						console.error('Or register sources first:');
						console.error('  mdq source add ~/docs --desc "Documentation"');
						console.error('  mdq mcp');
						process.exit(EXIT_CODES.INVALID_ARGS);
					}
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
							oauth: boolean;
							cert?: string;
							key?: string;
					  }
					| undefined;

				if (parsed.options.http) {
					// Get API key from flag or environment
					const apiKey = parsed.options.apiKey ?? process.env.MDQ_MCP_API_KEY ?? '';

					// Get port from flag, environment, or default
					const port =
						parsed.options.port ??
						(process.env.MDQ_MCP_PORT ? Number.parseInt(process.env.MDQ_MCP_PORT, 10) : 3000);

					// Get host from flag, environment, or default (localhost-only)
					const host = parsed.options.host ?? process.env.MDQ_MCP_HOST ?? '127.0.0.1';

					httpOptions = {
						enabled: true,
						port,
						host,
						apiKey,
						noAuth: parsed.options.noAuth,
						oauth: parsed.options.oauth,
						cert: parsed.options.cert,
						key: parsed.options.key,
					};
				}

				await runMcpCommand(sources, httpOptions);
				// Don't call process.exit() for HTTP server mode - let it run indefinitely
				// The server will keep the event loop alive
				if (httpOptions?.enabled) {
					return;
				}
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

				const embedOptions = {
					batchSize: parsed.options.batchSize,
					timeLimitMinutes: parsed.options.timeLimitMinutes,
					reset: parsed.options.reset,
					dryRun: parsed.options.dryRun,
					verbose: parsed.options.verbose,
				};

				// If --path is explicitly specified, embed just that path
				if (parsed.options.path) {
					const result = await runEmbedCommand(basePath, embedOptions);
					console.log(formatter.format(result));
				} else {
					// Otherwise, embed all registered sources
					const registered = validateRegisteredSources();

					// Embed each registered source
					for (const source of registered) {
						console.log(`Embedding ${source.name} (${source.path})...`);
						const result = await runEmbedCommand(source.path, embedOptions);
						console.log(formatter.format(result));
					}
				}
				break;
			}

			default:
				console.error(formatter.formatError({ message: `Unknown command: ${parsed.command}` }));
				printHelp();
				process.exit(EXIT_CODES.INVALID_ARGS);
		}

		// Explicitly exit to clean up any lingering connections (e.g., MeiliSearch client)
		process.exit(EXIT_CODES.SUCCESS);
	} catch (error) {
		handleError(error, formatter);
	}
}
