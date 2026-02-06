import { randomBytes } from 'node:crypto';
import { EXIT_CODES } from '../../lib/errors.js';

export interface TokenCommandArgs {
	subcommand: string;
	options: {
		length?: number;
	};
}

/**
 * Generate a cryptographically secure API token.
 * Default length: 32 bytes (64 hex characters)
 */
function generateToken(bytes = 32): string {
	return randomBytes(bytes).toString('hex');
}

/**
 * Run: mdq token generate
 * Generate a new secure API token for Bearer authentication.
 */
function runTokenGenerate(args: TokenCommandArgs): void {
	// Default to 32 bytes (64 hex chars) for strong security
	const bytes = args.options.length ?? 32;

	// Enforce minimum length (16 bytes = 32 hex chars)
	if (bytes < 16) {
		console.error('Error: Token must be at least 16 bytes (32 hex characters)');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	// Enforce maximum length (128 bytes = 256 hex chars)
	if (bytes > 128) {
		console.error('Error: Token must be at most 128 bytes (256 hex characters)');
		process.exit(EXIT_CODES.INVALID_ARGS);
	}

	const token = generateToken(bytes);

	console.log('API Token generated successfully!\n');
	console.log(`Token: ${token}\n`);
	console.log('Save this token securely - it will not be shown again.\n');
	console.log('To use with mdq:');
	console.log(`  export MDQ_MCP_API_KEY="${token}"`);
	console.log('  mdq mcp --http\n');
	console.log('Or pass directly:');
	console.log(`  mdq mcp --http --api-key "${token}"\n`);
	console.log('For .env file:');
	console.log(`  MDQ_MCP_API_KEY=${token}`);
}

/**
 * Main token command router.
 */
export function runTokenCommand(args: TokenCommandArgs): void {
	switch (args.subcommand) {
		case 'generate':
			runTokenGenerate(args);
			break;

		default:
			console.error('Usage: mdq token <command>');
			console.error('');
			console.error('Commands:');
			console.error('  generate    Generate a new secure API token');
			console.error('');
			console.error('Options (for generate):');
			console.error('  --length <n>    Token length in bytes (default: 32, min: 16, max: 128)');
			console.error('');
			console.error('Examples:');
			console.error('  mdq token generate');
			console.error('  mdq token generate --length 64');
			process.exit(EXIT_CODES.INVALID_ARGS);
	}
}
