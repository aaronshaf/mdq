import os from 'node:os';
import path from 'node:path';

export interface Source {
	name: string;
	path: string;
	description?: string;
}

/**
 * Expand leading ~ to user's home directory.
 * Handles `~` and `~/path` but not:
 *   - `~user/path` (different user's home - not supported)
 *   - `foo/~/bar` (~ in middle of path - not expanded)
 */
function expandTilde(p: string): string {
	if (p === '~') return os.homedir();
	if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
	return p;
}

export interface ParseSourcesResult {
	sources: Source[];
	errors: string[];
}

/**
 * Check if a colon at the given index is part of a Windows drive letter.
 * Handles both C:\ and C:/ formats.
 */
function isWindowsDriveLetter(arg: string, colonIndex: number): boolean {
	if (colonIndex !== 1) return false;
	const charAfterColon = arg[2];
	return charAfterColon === '\\' || charAfterColon === '/' || charAfterColon === undefined;
}

/**
 * Parse source arguments into Source objects.
 * Supports formats:
 *   - `/path/to/dir` -> name derived from directory basename
 *   - `name:/path/to/dir` -> explicit name
 *   - `name:/path/to/dir|description` -> explicit name with description
 *   - `/path/to/dir|description` -> derived name with description
 *
 * Features:
 *   - `~` is expanded to user's home directory
 *   - `|` is reserved for descriptions (cannot be used in paths)
 */
export function parseSourceArg(arg: string): Source {
	// First, split off the description (if present) using pipe delimiter
	const pipeIndex = arg.indexOf('|');
	let pathPart: string;
	let description: string | undefined;

	if (pipeIndex >= 0) {
		pathPart = arg.slice(0, pipeIndex);
		const desc = arg.slice(pipeIndex + 1).trim();
		description = desc || undefined; // Convert empty string to undefined
	} else {
		pathPart = arg;
	}

	const colonIndex = pathPart.indexOf(':');

	// Check if there's a colon that's not part of a Windows drive letter (e.g., C:\ or C:/)
	// colonIndex >= 0 catches both empty name (colonIndex === 0) and normal explicit names
	const hasExplicitName = colonIndex >= 0 && !isWindowsDriveLetter(pathPart, colonIndex);

	if (hasExplicitName) {
		const name = pathPart.slice(0, colonIndex).toLowerCase();
		const sourcePath = expandTilde(pathPart.slice(colonIndex + 1));
		return {
			name,
			path: path.resolve(sourcePath),
			description,
		};
	}

	// Derive name from directory basename
	const resolvedPath = path.resolve(expandTilde(pathPart));
	const name = path.basename(resolvedPath).toLowerCase();

	return {
		name,
		path: resolvedPath,
		description,
	};
}

/**
 * Parse multiple source arguments and check for collisions.
 */
export function parseSources(args: string[]): ParseSourcesResult {
	const sources: Source[] = [];
	const errors: string[] = [];
	const seenNames = new Map<string, string>(); // name -> original path

	for (const arg of args) {
		const source = parseSourceArg(arg);

		// Validate non-empty name
		if (!source.name) {
			errors.push(`Invalid source: "${arg}" - source name cannot be empty`);
			continue;
		}

		// Check for name collision
		const existingPath = seenNames.get(source.name);
		if (existingPath) {
			errors.push(
				`Source name collision: "${source.name}" is used by both "${existingPath}" and "${source.path}"`,
			);
			continue;
		}

		seenNames.set(source.name, source.path);
		sources.push(source);
	}

	return { sources, errors };
}
