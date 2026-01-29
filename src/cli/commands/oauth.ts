import { randomBytes } from 'node:crypto';
import { EXIT_CODES } from '../../lib/errors.js';
import {
	addOAuthClient,
	getOAuthConfigPath,
	listOAuthClients,
	removeOAuthClient,
} from '../../lib/oauth/config.js';
import {
	cleanupExpiredTokens,
	getTokenStats,
	getTokenStoragePath,
	revokeClientTokens,
} from '../../lib/oauth/tokens.js';
import type { OAuthClient } from '../../lib/oauth/types.js';

export interface OAuthCommandArgs {
	subcommand: string;
	positional: string[];
	options: {
		clientId?: string;
		name?: string;
		redirectUris: string[]; // Multiple redirect URIs supported
	};
}

/**
 * Generate a cryptographically secure client secret.
 */
function generateClientSecret(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Run: mdq oauth setup
 * Create a new OAuth client with credentials.
 */
function runOAuthSetup(args: OAuthCommandArgs): void {
	// Get client ID from flag or positional arg, or generate one
	const clientId = args.options.clientId ?? args.positional[0] ?? `client-${Date.now()}`;

	// Get client name from flag or use default
	const clientName = args.options.name ?? 'Default Client';

	// Get redirect URIs from flags or use defaults (Claude + ChatGPT)
	const redirectUris =
		args.options.redirectUris.length > 0
			? args.options.redirectUris
			: [
					'https://claude.ai/api/mcp/auth_callback', // Claude web UI
					'https://chatgpt.com/connector_platform_oauth_redirect', // ChatGPT MCP connectors
				];

	// Generate client secret
	const clientSecret = generateClientSecret();

	// Create OAuth client
	const client: OAuthClient = {
		client_id: clientId,
		client_secret: clientSecret,
		redirect_uris: redirectUris,
		name: clientName,
	};

	try {
		addOAuthClient(client);

		console.log('OAuth client created successfully!\n');
		console.log(`Client ID:     ${client.client_id}`);
		console.log(`Client Secret: ${client.client_secret}`);
		console.log(`Client Name:   ${client.name}`);
		console.log(`Redirect URIs: ${redirectUris.join(', ')}\n`);

		console.log('Add to Claude web UI:');
		console.log('1. Go to Settings > Connectors > Add custom connector');
		console.log('2. URL: https://your-server.com/mcp');
		console.log(`3. OAuth Client ID: ${client.client_id}`);
		console.log(`4. OAuth Client Secret: ${client.client_secret}\n`);

		console.log('Start server with OAuth:');
		console.log('  # With HTTPS:');
		console.log('  mdq mcp --http --oauth --cert ./cert.pem --key ./key.pem');
		console.log('');
		console.log('  # Behind reverse proxy (HTTP):');
		console.log('  mdq mcp --http --oauth --host 127.0.0.1 --port 3001');
		console.log('  cloudflared tunnel --url http://localhost:3001\n');

		console.log(`Config saved to: ${getOAuthConfigPath()}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exit(EXIT_CODES.GENERAL_ERROR);
	}
}

/**
 * Run: mdq oauth list
 * List all configured OAuth clients.
 */
function runOAuthList(): void {
	const clients = listOAuthClients();

	if (clients.length === 0) {
		console.log('No OAuth clients configured.');
		console.log('Run "mdq oauth setup" to create a client.');
		return;
	}

	console.log(`OAuth Clients (${clients.length}):\n`);

	for (const client of clients) {
		console.log(`Client ID:    ${client.client_id}`);
		console.log(`Name:         ${client.name}`);
		console.log(`Redirect URI: ${client.redirect_uris.join(', ')}`);
		console.log('');
	}

	console.log(`Config file: ${getOAuthConfigPath()}`);
}

/**
 * Run: mdq oauth remove <client-id>
 * Remove an OAuth client and revoke its tokens.
 */
function runOAuthRemove(args: OAuthCommandArgs): void {
	const clientId = args.positional[0];

	if (!clientId) {
		console.error('Error: Client ID required');
		console.error('Usage: mdq oauth remove <client-id>');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	try {
		const removed = removeOAuthClient(clientId);

		if (!removed) {
			console.error(`Error: Client "${clientId}" not found`);
			process.exit(EXIT_CODES.GENERAL_ERROR);
		}

		// Revoke all tokens for this client
		const revokedCount = revokeClientTokens(clientId);

		console.log(`OAuth client "${clientId}" removed successfully`);
		if (revokedCount > 0) {
			console.log(`Revoked ${revokedCount} token(s)`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exit(EXIT_CODES.GENERAL_ERROR);
	}
}

/**
 * Run: mdq oauth status
 * Show OAuth status and active tokens.
 */
function runOAuthStatus(): void {
	const clients = listOAuthClients();
	const stats = getTokenStats();

	console.log('OAuth Status:\n');

	if (clients.length === 0) {
		console.log('OAuth: DISABLED (no clients configured)');
		console.log('Run "mdq oauth setup" to create a client.\n');
		return;
	}

	console.log(`OAuth: ENABLED (${clients.length} client(s) configured)`);
	console.log(`Config file: ${getOAuthConfigPath()}\n`);

	console.log('Configured Clients:');
	for (const client of clients) {
		console.log(`  - ${client.name} (${client.client_id})`);
	}

	console.log('\nToken Statistics:');
	console.log(
		`  Authorization codes: ${stats.authCodes.total} total, ${stats.authCodes.expired} expired`,
	);
	console.log(
		`  Access tokens:       ${stats.accessTokens.total} total, ${stats.accessTokens.expired} expired`,
	);
	console.log(`  Token storage:       ${getTokenStoragePath()}`);

	// Clean up expired tokens
	const cleaned = cleanupExpiredTokens();
	if (cleaned.codes > 0 || cleaned.tokens > 0) {
		console.log(
			`\nCleaned up ${cleaned.codes} expired code(s) and ${cleaned.tokens} expired token(s)`,
		);
	}
}

/**
 * Main OAuth command router.
 */
export function runOAuthCommand(args: OAuthCommandArgs): void {
	switch (args.subcommand) {
		case 'setup':
			runOAuthSetup(args);
			break;

		case 'list':
			runOAuthList();
			break;

		case 'remove':
			runOAuthRemove(args);
			break;

		case 'status':
			runOAuthStatus();
			break;

		default:
			console.error('Usage: mdq oauth <command>');
			console.error('');
			console.error('Commands:');
			console.error('  setup                  Create a new OAuth client');
			console.error('  list                   List configured OAuth clients');
			console.error('  remove <client-id>     Remove an OAuth client');
			console.error('  status                 Show OAuth status and tokens');
			console.error('');
			console.error('Options (for setup):');
			console.error('  --client-id <id>       Client ID (default: auto-generated)');
			console.error('  --name <name>          Client name (default: "Default Client")');
			console.error(
				'  --redirect-uri <uri>   Redirect URI (repeatable, defaults: Claude + ChatGPT)',
			);
			process.exit(EXIT_CODES.INVALID_ARGS);
	}
}
