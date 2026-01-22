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

interface ParsedSource extends Source {
	hasExplicitName: boolean;
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
export function parseSourceArg(arg: string): ParsedSource {
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
			hasExplicitName: true,
		};
	}

	// Derive name from directory basename
	const resolvedPath = path.resolve(expandTilde(pathPart));
	const name = path.basename(resolvedPath).toLowerCase();

	return {
		name,
		path: resolvedPath,
		description,
		hasExplicitName: false,
	};
}

/**
 * Derive a unique name by adding parent path segments.
 * E.g., /home/user/work/docs -> work-docs -> user-work-docs
 */
function deriveUniqueName(sourcePath: string, existingNames: Set<string>): string {
	const segments = sourcePath.split(path.sep).filter(Boolean);
	let name = '';

	// Build name from end of path, adding segments until unique
	for (let i = segments.length - 1; i >= 0; i--) {
		const segment = segments[i]!.toLowerCase();
		name = name ? `${segment}-${name}` : segment;

		if (!existingNames.has(name)) {
			return name;
		}
	}

	// If still not unique (same full path?), return the full name
	return name;
}

/**
 * Parse multiple source arguments and auto-resolve name collisions.
 * Explicit names still error on collision; derived names are auto-resolved.
 */
export function parseSources(args: string[]): ParseSourcesResult {
	const errors: string[] = [];

	// First pass: parse all sources
	const parsed: ParsedSource[] = [];
	for (const arg of args) {
		const source = parseSourceArg(arg);

		if (!source.name) {
			errors.push(`Invalid source: "${arg}" - source name cannot be empty`);
			continue;
		}

		parsed.push(source);
	}

	// Second pass: detect collisions and auto-resolve derived names
	const finalNames = new Map<string, string>(); // name -> path (for explicit collision detection)
	const usedNames = new Set<string>();
	const sources: Source[] = [];

	for (const source of parsed) {
		if (source.hasExplicitName) {
			// Explicit names: error on collision
			const existingPath = finalNames.get(source.name);
			if (existingPath) {
				errors.push(
					`Source name collision: "${source.name}" is used by both "${existingPath}" and "${source.path}"`,
				);
				continue;
			}
			finalNames.set(source.name, source.path);
			usedNames.add(source.name);
			sources.push({ name: source.name, path: source.path, description: source.description });
		} else {
			// Derived names: auto-resolve collisions
			let name = source.name;
			if (usedNames.has(name)) {
				name = deriveUniqueName(source.path, usedNames);
			}
			usedNames.add(name);
			sources.push({ name, path: source.path, description: source.description });
		}
	}

	return { sources, errors };
}
