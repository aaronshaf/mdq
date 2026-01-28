import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SourceConfig {
	name: string;
	path: string;
	description?: string;
}

export interface Config {
	sources: SourceConfig[];
}

/**
 * Get the path to the config file.
 * Respects XDG_CONFIG_HOME, defaults to ~/.config/mdq/sources.json
 */
export function getConfigPath(): string {
	const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
	return path.join(configHome, 'mdq', 'sources.json');
}

/**
 * Load the config file, returning empty sources array if it doesn't exist.
 * Warns to stderr if the config file exists but is corrupt.
 */
export function loadConfig(): Config {
	const configPath = getConfigPath();

	// Check if file exists first
	if (!fs.existsSync(configPath)) {
		return { sources: [] };
	}

	try {
		const content = fs.readFileSync(configPath, 'utf-8');
		const parsed = JSON.parse(content) as Config;

		// Validate structure
		if (!parsed.sources || !Array.isArray(parsed.sources)) {
			console.error(`Warning: Config file has invalid structure: ${configPath}`);
			console.error('Expected { "sources": [...] }. Using empty sources list.');
			return { sources: [] };
		}

		return parsed;
	} catch (error) {
		// File exists but is invalid JSON
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Warning: Failed to parse config file: ${configPath}`);
		console.error(`  ${message}`);
		console.error('Using empty sources list.');
		return { sources: [] };
	}
}

/**
 * Save the config file, creating the directory if needed.
 */
export function saveConfig(config: Config): void {
	const configPath = getConfigPath();
	const configDir = path.dirname(configPath);

	// Ensure directory exists
	fs.mkdirSync(configDir, { recursive: true });

	// Write with pretty-print
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

/**
 * Add a source to the config.
 * Throws if a source with the same name already exists.
 */
export function addSource(source: SourceConfig): void {
	const config = loadConfig();

	// Check for duplicate name
	const existing = config.sources.find((s) => s.name === source.name);
	if (existing) {
		throw new Error(`Source with name "${source.name}" already exists (path: ${existing.path})`);
	}

	config.sources.push(source);
	saveConfig(config);
}

/**
 * Remove a source by name.
 * Returns true if removed, false if not found.
 */
export function removeSource(name: string): boolean {
	const config = loadConfig();
	const originalLength = config.sources.length;

	config.sources = config.sources.filter((s) => s.name !== name);

	if (config.sources.length === originalLength) {
		return false;
	}

	saveConfig(config);
	return true;
}

/**
 * List all registered sources.
 */
export function listSources(): SourceConfig[] {
	return loadConfig().sources;
}
