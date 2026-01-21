import path from 'node:path';

export interface Source {
	name: string;
	path: string;
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
 */
export function parseSourceArg(arg: string): Source {
	const colonIndex = arg.indexOf(':');

	// Check if there's a colon that's not part of a Windows drive letter (e.g., C:\ or C:/)
	// colonIndex >= 0 catches both empty name (colonIndex === 0) and normal explicit names
	const hasExplicitName = colonIndex >= 0 && !isWindowsDriveLetter(arg, colonIndex);

	if (hasExplicitName) {
		const name = arg.slice(0, colonIndex).toLowerCase();
		const sourcePath = arg.slice(colonIndex + 1);
		return {
			name,
			path: path.resolve(sourcePath),
		};
	}

	// Derive name from directory basename
	const resolvedPath = path.resolve(arg);
	const name = path.basename(resolvedPath).toLowerCase();

	return {
		name,
		path: resolvedPath,
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
