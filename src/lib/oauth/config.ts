import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OAuthClient, OAuthConfig } from './types.js';
import { OAuthConfigSchema } from './types.js';

/**
 * Get the path to the OAuth config file.
 * Respects XDG_CONFIG_HOME, defaults to ~/.config/mdq/oauth.json
 */
export function getOAuthConfigPath(): string {
	const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
	return path.join(configHome, 'mdq', 'oauth.json');
}

/**
 * Load the OAuth config file, returning disabled config if it doesn't exist.
 * Warns to stderr if the config file exists but is corrupt.
 */
export function loadOAuthConfig(): OAuthConfig {
	const configPath = getOAuthConfigPath();

	// Check if file exists first
	if (!fs.existsSync(configPath)) {
		return { enabled: false, clients: [] };
	}

	try {
		const content = fs.readFileSync(configPath, 'utf-8');
		const parsed = JSON.parse(content);

		// Validate with Zod
		const validated = OAuthConfigSchema.parse(parsed);
		return validated;
	} catch (error) {
		// File exists but is invalid JSON or doesn't match schema
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Warning: Failed to parse OAuth config file: ${configPath}`);
		console.error(`  ${message}`);
		console.error('OAuth will be disabled.');
		return { enabled: false, clients: [] };
	}
}

/**
 * Save the OAuth config file, creating the directory if needed.
 * Sets file permissions to 0600 (owner read/write only).
 */
export function saveOAuthConfig(config: OAuthConfig): void {
	const configPath = getOAuthConfigPath();
	const configDir = path.dirname(configPath);

	// Ensure directory exists
	fs.mkdirSync(configDir, { recursive: true });

	// Write with pretty-print
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

	// Set permissions to 0600 (owner read/write only)
	fs.chmodSync(configPath, 0o600);
}

/**
 * Add a client to the OAuth config.
 * Throws if a client with the same client_id already exists.
 */
export function addOAuthClient(client: OAuthClient): void {
	const config = loadOAuthConfig();

	// Check for duplicate client_id
	const existing = config.clients.find((c) => c.client_id === client.client_id);
	if (existing) {
		throw new Error(
			`OAuth client with ID "${client.client_id}" already exists (name: ${existing.name})`,
		);
	}

	config.clients.push(client);
	config.enabled = true; // Enable OAuth when first client is added
	saveOAuthConfig(config);
}

/**
 * Remove a client by client_id.
 * Returns true if removed, false if not found.
 * Disables OAuth if this was the last client.
 */
export function removeOAuthClient(clientId: string): boolean {
	const config = loadOAuthConfig();
	const originalLength = config.clients.length;

	config.clients = config.clients.filter((c) => c.client_id !== clientId);

	if (config.clients.length === originalLength) {
		return false;
	}

	// Disable OAuth if no clients remain
	if (config.clients.length === 0) {
		config.enabled = false;
	}

	saveOAuthConfig(config);
	return true;
}

/**
 * Get a client by client_id.
 * Returns undefined if not found.
 */
export function getOAuthClient(clientId: string): OAuthClient | undefined {
	const config = loadOAuthConfig();
	return config.clients.find((c) => c.client_id === clientId);
}

/**
 * List all configured OAuth clients.
 */
export function listOAuthClients(): OAuthClient[] {
	return loadOAuthConfig().clients;
}

/**
 * Check if OAuth is enabled.
 */
export function isOAuthEnabled(): boolean {
	return loadOAuthConfig().enabled;
}
